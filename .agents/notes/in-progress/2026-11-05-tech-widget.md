---
status: in-progress
---

# Technical widget / board — data, reconcile, lifecycle, recovery

> 技术设计 L2；根见 [tech-architecture](./2026-11-05-tech-architecture.md)；UI 数据见 [tech-ui](./2026-11-05-tech-ui.md)；行为见 [product experience](./2026-11-05-product-experience.md)。
> 本文给 widget / board 的字段级数据、reconcile 规则、完整生命周期、recovery、拖拽 / dock / reset 状态机、并发、错误、测试。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：

- widget / board 的数据模型与不变量；
- board 从 widget 贡献的 **reconcile**；
- board root（`LayoutState`，无 `WidgetPlacement`）；
- 完整生命周期与 **recovery**（刷新 / open folder）；
- widget registry / board store / drag service；
- 跨 board / window 的 move；
- dock 拖拽；
- reset location / Reset All；
- 持久化 / 并发 / 错误 / 测试。

**不在本 note**：board 视觉样式 → [product experience](./2026-11-05-product-experience.md)；widget 来源内容 → [tech-ide](./2026-11-05-tech-ide.md) / [tech-agent](./2026-11-05-tech-agent.md)；window 的 WM → [tech-ui](./2026-11-05-tech-ui.md)。

> **约定**：“不在本 note”表示由其他 note / 系统拥有，不等于 prac 不做；真正的 non-goal 见 [product design](./2026-11-05-product-design.md) §7。

## 2. 数据模型

### 2.1 widget

`PracWidget` 是运行时的 widget；extension 贡献 `PracWidgetDef`（声明：[tech-extension](./2026-11-05-tech-extension.md)）。**widget 是单例**：一个 widget 只在一个 board 里，`boardId` 是它的唯一当前归属。

```ts
interface PracWidget {
  readonly def: PracWidgetDef;   // id / title / icon / defaultBoard
  readonly source: string;       // "vscode:view" / "dsh:slot" / "prac:…"
  readonly boardId: string;      // 唯一当前归属
  content(): () => ReactNode;
  actions?(): ReactNode;
}
```

- `defaultBoard` 只是“首次放置”的默认值，**不是当前归属**；
- `boardId` 改了就换了 board（move / split / reset 的结果）；
- 一个 widget 不会同时出现在两个 board。

### 2.2 board

board 是 **prac core** 的编排对象，**不由 extension 直接贡献**：extension 只贡献 widget，board 由 prac 从 widget 的 `defaultBoard` 经 reconcile 推导。

```ts
interface PracBoardDef {
  readonly id: string;
  readonly title: string;
  readonly appId: string;        // "prac.board"
  readonly defaultRegion?: string;
}

interface PracBoard {
  readonly def: PracBoardDef;
  readonly root: LayoutState;    // board 的布局树
  readonly active?: string;      // active widget id
  readonly pinned: boolean;      // dock 是否显示
}
```

### 2.3 为什么没有 `WidgetPlacement`

board root 是 `LayoutState`（[tech-ui](./2026-11-05-tech-ui.md) §2.1），它的 `items` 就是 `ItemRecord`：

```ts
interface ItemRecord {
  region: string;
  order: number;
  size?: number;
  collapsed?: boolean;
  hidden?: boolean;
  front?: boolean;
}
```

widget 的“在哪个 region、什么顺序、多大、是否折叠 / 隐藏”**全部由 `LayoutState` 拥有**；widget 没有 `LayoutState` 之外的字段（对照 `WindowPlacement` 的 `contentId` / `boardId` / `contentRegion` / `max` / `cachedSize` 是窗口独有的）。

所以：

- **不设 `WidgetPlacement`**；board root 的 item id = widget id；
- widget 的归属由 `PracWidget.boardId` 唯一决定；
- 任何时刻只有 `PracWidget`（身份 + 归属）与 `LayoutState`（位置 + 几何）两个真相源，不产生第三个。

### 2.4 不变量

- widget 单例：一个 widget 只在一个 board（`PracWidget.boardId`）；
- board root 的每个 item 必须对应一个 `PracWidget`，其 `boardId` 等于该 board；
- `PracBoard.active` 必须是该 board 的 widget；否则忽略 / heal；
- board root 同时只有一个 writer（drag / reset / layout）；
- board root 的 item id 唯一；
- 跨 board 只允许 move；split 只在目标 board root 内。

## 3. Services

### 3.1 widget registry

`ctx.pracWidgets` 是 widget registry + widget 操作入口。它持有 `PracWidget` 的注册 / 身份，负责 `open` / `move` / `reset`；不拥有 board layout，也不拥有 window（WM）。所有写 board 的操作最终落到目标 board 的 `LayoutState` 单写者。

```ts
interface PracWidgets {
  register(widget: PracWidget): () => void;
  list(): readonly PracWidget[];
  get(id: string): PracWidget | undefined;
  onDidChange(listener: () => void): () => void;
  open(widgetId: string, boardId?: string): void;
  move(widgetId: string, targetBoardId: string, placement: {
    region: string; order?: number; split?: "left" | "right" | "up" | "down";
  }): void;
  reset(widgetId: string): void;
  resetAll(): void;
}
```

- `register`：widget 出现；duplicate id → `DUPLICATE_WIDGET`；
- `onDidChange`：widget 增删（reconcile 的输入）；
- `open`：无 board → `PracWidget.boardId`；有 board → 放进去并 active；
- `move`：跨 board / 同 board；不改 `source`，改 `boardId`；
- `reset` / `resetAll`：见 §6。

### 3.2 board store + reconcile

`PracBoards` 持有 `PracBoard` 与它的 `LayoutState`，并执行 reconcile。它只写自己的 board root；一次 `update` 原子替换；board 删除先 detach widget（改 `boardId`），再删 state；不销毁来源，也不动 window。

```ts
interface PracBoards {
  list(): readonly PracBoard[];
  get(id: string): PracBoard | undefined;
  update(id: string, updater: (board: PracBoard) => PracBoard): void;
  subscribe(listener: () => void): () => void;
  /** 从 widget 贡献推导 board；幂等。 */
  reconcile(widgets: readonly PracWidget[]): void;
  pin(id: string): void;
  unpin(id: string): void;
}
```

- `reconcile` 的规则见 §4.2；
- `pin` / `unpin` 只改 `pinned`，不动 board 与窗口（§4.4）。

### 3.3 drag service

`DragService` 是 transient session：不持有 board 状态，只在 `drop` 时提交；同一时刻只允许一个 session；`hover` 只改高亮 / 展开，不写 board。

```ts
interface DragService {
  begin(widgetId: string, sourceBoardId: string, pointer: Point): DragSession;
  hover(session: DragSession, target: DropTarget): void;
  drop(session: DragSession, target: DropTarget): void;
  cancel(session: DragSession): void;
}
```

- 同一时刻只允许一个 session；`begin` 时已有 → `DRAG_BUSY`；
- `hover` 只改高亮 / 展开；不写 board；
- `drop` 才提交；失败回滚；
- `cancel` 删除本次新建的空 board（如果有）。

## 4. 生命周期

```
contribute → reconcile → place → pin → open → persist → recover
```

### 4.1 contribute

extension 激活时贡献 `PracWidgetDef`；registry 把它变成 `PracWidget`（`boardId` 尚未确定，等 reconcile）。

### 4.2 reconcile

reconcile 的输入是当前的 widget 集合，输出是 board 集合。它在 widget 增删时跑，**幂等**。

| 情况 | 结果 |
| --- | --- |
| widget 首次出现 | 若其 `defaultBoard` 的 board 存在 → 加入；否则创建 board 再加入 |
| widget 已存在且有 `boardId` | 不动（尊重用户移动） |
| widget 的 `boardId` 指向不存在的 board | 回到 `defaultBoard`（heal） |
| widget 消失 | 从 board root 移除；`boardId` 随之失效 |
| board 变空 | 保留（§7.4） |
| board 的 widget 全部不是它的 | 保留（空 board 仍可被 pin / 打开） |

关键：**`defaultBoard` 只在“首次出现”和“heal”时生效**；正常移动后 `boardId` 优先。

### 4.3 place

board root 的 item 由 `LayoutState` 的 `ItemRecord` 承载；`place(widgetId, region)` / `move` / `split` 都写这一层。

### 4.4 pin

`PracBoard.pinned` 决定 dock 是否显示：

- `pin(id)`：`pinned = true`；
- `unpin(id)`：`pinned = false`；
- unpin 不影响 board、widget、窗口；
- 关闭 board 窗口 ≠ unpin。

### 4.5 open

`createBoardWindow(boardId)` 创建 `PracWindow`（app = `prac.board`）并 `admit`；窗口的 `instanceId` 指向实例管理器。board 可被多个窗口显示时由 open 决定（§11）。

### 4.6 persist

见 §7。

### 4.7 recover

见 §7。

## 5. Move / split

- **跨 root**：只 move；source 不变；目标 board root 写；源 widget 的 `boardId` 改；
- **同 board**：move / split left/right/up/down；split 在目标 root 内创建 region；
- **不跨 window 合并**：两个 window 的 widget 不拼成一个跨 window region；
- **顺序**：move 先移除源 item，再插入目标；失败回滚；
- **active**：目标 board 的 active 设为被移动 widget；源 board active 回退。

## 6. Reset location

- **widget 级**：`reset(widgetId)` 回 `defaultBoard` + 默认顺序；不改 size；
- **单 widget board**：代理该 widget 的 reset；显示条件 = 当前 board != default board；
- **Move To**：非默认 board 时，reset 回默认 board 并 append；
- **Reset All**：所有 widget 回默认；board 本身不变；不改 size；
- **空 board**：reset 后留下的空 board 保留（§7.4）；
- **不重置**：size、window 几何、board 几何。

## 7. 持久化与 recovery

### 7.1 key

- board：`prac-board/v1/<scope>/<board>`；scope = `?workspace=` 哈希；
- 内容：widget 顺序 / region / collapsed / size / active；board root tree / weights；`pinned`；
- board window 的 window 记录由 frame key 持久化；
- board 内容由 board key 持久化。

### 7.2 recovery 顺序

刷新页面 / open folder 时：

```
1. re-contribute       extension 重新贡献 widget（registry 就绪）
2. reconcile           从 defaultBoard 推导 board（此时还没有 persisted 数据）
3. load persisted       读 prac-board/v1/<scope>/<board>
4. adopt                persisted 的 widget 归属覆盖 reconcile 的结果
5. pin                 恢复 dock 的 pinned
6. restore windows     frame key → PracWindow（board / editor）
```

### 7.3 优先级

| 数据 | 优先级 |
| --- | --- |
| persisted 的 widget 归属（`boardId`） | **高于** reconcile 的 `defaultBoard` |
| persisted 的 region / order / size | 高于默认值 |
| persisted 的 `pinned` | 高于默认 |
| reconcile 的 `defaultBoard` | 仅在 persisted 缺失 / heal 时生效 |

heal：未知 widget → 丢；未知 region → 放默认；active 无效 → 清；persisted 的 board 没有对应 widget → 丢该 item。

### 7.4 空 board

- 空 board **保留**；它仍可被 pin / 打开；
- 显式删除才移除（`PracBoards` 没有自动删除）；
- 避免“拖走最后一个 widget 就丢布局”。

### 7.5 原子性

一次 board update 一个 key；失败保留旧值。

## 8. 并发 / 顺序

- drag 单 session；drop 提交前不写 board；
- reset 与 drag 冲突：reset 先取消 drag（MVP）；
- board 关闭 / 删除与 drag：取消 drag；不写已删 board；
- 多个 window 显示同一 board：写入串行；
- 跨 Space：拖动只在本 Space 的 board / dock；跨 Space 是 open。

## 9. Errors

| 错误 | 触发 | 处理 |
|---|---|---|
| `UNKNOWN_WIDGET` | move / reset 未注册 | reject |
| `UNKNOWN_BOARD` | 目标 board 不存在 | reject |
| `INCOMPATIBLE_BOARD` | 目标不接受该 widget | reject |
| `DUPLICATE_WIDGET` | register 重复 | reject |
| `DRAG_BUSY` | 已有 drag | reject |
| `DROP_OUTSIDE` | drop 非目标 | cancel |
| `BOARD_BUSY` | 多 writer | 拒绝 / 排队（open） |

## 10. Testing

- **unit**：reconcile（首次 / 移动后 / heal / widget 消失）、move 跨 board、split、active 回退、reset / Reset All、未知 / 冲突、持久化 heal、recovery 顺序与优先级；
- **L2**：drag begin → drop → board state；cancel → 源不变；new board → 提交 / 回滚；
- **live**：board / containers；planned：widget:move / widget:window / isolation:mixed；
- **matrix**：跨 board、同 board、dock 图标 / 空白 / 非目标、单 widget board reset、多 window、刷新 recovery、open folder recovery。

## 11. Open

1. **multi-instance widget**：同一来源多个实例的 id / key；
2. **copy 语义**：copy 只在显式能力下；默认 move；
3. **跨 Space**：是否允许；目标 Space 的 board / dock；
4. **dock overflow**：很多 board 时的滚动 / 分组；
5. **board 多 window**：同一 board 多 window 的写冲突；
6. **reset index**：default order 的 index 语义；
7. **size reset**：不改 size 是否最终确定；
8. **reconcile 的删除规则**：widget 消失后，若 board 变空，是否保留由 §7.4 决定；若 board 的 `def` 也随之消失（extension 卸载），board 是否保留。

## Related

- [tech architecture](./2026-11-05-tech-architecture.md)：进程 / 模块 / 协议根。
- [tech-ui](./2026-11-05-tech-ui.md)：window / group / layout / persistence。
- [tech-extension](./2026-11-05-tech-extension.md)：PracWidgetDef / catalog / runtime。
- [product experience](./2026-11-05-product-experience.md)：拖拽 / dock / reset 行为。
