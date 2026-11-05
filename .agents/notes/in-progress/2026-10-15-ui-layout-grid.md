---
status: in-progress
---

# Agent Note: frame geometry — Space、grid、region 与 surface

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

`ui-frame` 拥有 prac 的几何与 frame chrome：

- Space；
- split / grid / region；
- dock rail / sidebar / panel；
- sash / track / resize / collapse；
- frame 的外层布局与区域角色。

它**不拥有** window / widget 的内容；region 的内容根是 **surface**：

| region | surface |
|---|---|
| stage 的 grid cell | **window group** |
| primarySidebar / secondarySidebar / panel | **window group**（承载 board window） |
| opaque host | 外部内容 |

几何契约（split / grid / region / sash / track / resize）不因为 window / widget 模型改变。

## Problem

prac 的 stage 需要 VS Code editor part / Grid 级别的分栏能力，但当前区域只有 `size` / `flex` / `min`，缺少：

- `max`；空间紧张时没有优先级；
- `Sizing`（同轴重新分配 vs 只推邻居）；
- edge snap（拖到边缘吸附 / 收起）；
- `maximized` 单元格；
- 拖到最小值时的收起 / 恢复反馈。

同时，region 的内容根以前统一是 view group；在 window / widget 模型下，stage region 是 window group，sidebar / panel region 是承载 board window 的 window group。

## 1. 几何模型

```text
Space
  split / grid / region
       └─ surface
            ├─ window group（stage cell）
            └─ window group（sidebar / panel，内含 board window）
```

- **split**：一维分区，孩子是 layout node；
- **grid**：二维分区，行 / 列 / cell / span；stage 的内容是 grid；
- **region**：叶子盒子，只有一个 surface；
- **surface**：window group / opaque host；
- **placement**：window → window group；widget → board root；
- **active**：window group 的 active window；board 的 active widget。

## 2. Grid

stage 是 `GridNode` + 显式 `GridPlacement`：

- 默认 2×2；一个 cell 时透明渲染，初始几何不变；
- `splitView` / `createRegionBeside` 按来源方向放新 cell，扩展行 / 列；
- cell 可以 move（swap placement）、resize（span，拒绝重叠）、merge / unmerge；merge 保留原始 placement，unmerge 恢复不等 span；
- `columnWeights` / `rowWeights` 负责自由 track resize；拖 track 边界改相对权重，权重持久化；
- merge / unmerge 的 placement 数据持久化。

## 3. 区域能力

| 能力 | 语义 |
|---|---|
| `min` / `max` | 分配、sash、窗口变化都收敛在区间内 |
| `priority` | 空间紧张时谁先让位；中心默认 High，最后让位 |
| `Sizing` | `Distribute`（同轴按比例吸收）或 `Expand`（只推邻居）；默认 Distribute |
| edge snap | 拖到边缘吸附并收起该 region；拖回恢复原尺寸 |
| `maximized` | 临时最大化一个 cell；不写进持久化 |
| `visible` | 收起 / 空区域不渲染；与 surface 生命周期解耦 |

## 4. Surface

- `ui-frame` 只认 surface registry，不 import `ui-window` / `ui-widget`；
- stage region 向 registry 要 window group surface；
- sidebar / panel region 向 registry 要承载 board window 的 window group；
- surface 负责自己的内容、lifecycle、isolation；
- frame 负责 region 的几何、collapse、resize、active surface；
- window group / board 的 active 是 surface 内部状态，不是 region 的字段。

### 4.1 Layout roots 与 board hole

frame 的外层 layout 和 board window 的内容 layout 共用同一个 **LayoutEngine**，但各自拥有 `LayoutRoot`：

```ts
interface LayoutRoot {
  id: string;
  kind: "frame" | "board";
  tree: LayoutNode;
  active?: string;
}
```

- `frame root` 的 item 是 window；`board root` 的 item 是 widget；
- split / grid / region / stack / sash / resize / persistence 共用同一套算法；
- root 只决定 item 类型与边界。

board 的 layout root 是 window content 里的 **hole**，对 frame 的 layout 可见：

```text
frame root
  └─ window
       └─ content
            └─ board root（hole）
                 └─ widget / split / stack
```

- window 仍是 content / lifecycle / focus / theme 的边界；
- board root 参与 frame 的 hit-test、拖拽、尺寸与 split；
- 视觉裁剪、focus、active window 仍由 window 边界负责；
- 跨 root 拖拽只允许 **move**；split 在目标 board root 内完成，不在 frame 层把两个 window 的 widget 拼成一个 region。

### 4.2 Chrome 与 layout 的分界

tab / stack / sash / actions 不是同一类东西：

| 项 | 归属 | 说明 |
|---|---|---|
| **stack** | layout | 一种 region 排布模式；行高、fold、active 属于 layout state |
| **stack row header** | chrome | 标题、fold 按钮、drag 手柄由容器组件提供，不写进 LayoutEngine |
| **tab strip** | chrome / container | WindowGroup 或 board 的成员控制面；order / active 由容器模型提供，strip 是它的视图 |
| **sash** | 两边 | 边界位置、命中范围、resize 数学属于 layout；可视手柄、光标、样式属于 chrome |
| **actions** | chrome | 由 item / container / adapter 提供，不属于 layout |

因此 `LayoutRenderer<TRecord>` 只负责几何与 item 渲染，并通过 chrome slots 交给容器：

```ts
interface LayoutChrome<TRecord> {
  renderTabs?(state, regionId, itemRenderer): ReactNode;
  renderRowHeader?(state, regionId, itemRenderer): ReactNode;
  renderSash?(state, splitId, index): ReactNode;
  renderActions?(state, regionId, itemId): ReactNode;
}
```

- WindowGroup 提供 tab strip + window actions；
- board 提供 widget header / tabs + widget actions；
- renderer 不硬编码任何一种 chrome；
- LayoutEngine 不包含 tab / actions / 样式。

### 4.3 Chrome 的可扩展性

固定 `renderTabs` / `renderActions` 方法只能“替换”，不能任意“增加 / 删除 / 自定义”。可扩展的 chrome 用 **anchor + contribution**：

```ts
type ChromeAnchor =
  | "region.tabs"
  | "region.header"
  | "row.header"
  | "split.sash"
  | "region.overlay";

interface ChromeContribution<TRecord> {
  readonly id: string;
  readonly anchor: ChromeAnchor;
  readonly order?: number;
  render(ctx: ChromeContext<TRecord>): ReactNode;
  /** Space this chrome reserves from the node's content box. */
  metrics?(ctx: ChromeContext<TRecord>): ChromeMetrics;
}

interface ChromeRegistry<TRecord> {
  add(contribution: ChromeContribution<TRecord>): () => void;
  remove(id: string): void;
  list(anchor: ChromeAnchor): readonly ChromeContribution<TRecord>[];
}
```

- **增加**：注册一个 contribution；
- **减少**：移除默认 contribution 或按 id disable；
- **自定义**：在 anchor 内渲染任意元素；
- **替换**：先移除默认，再注册自己的；
- chrome 通过 `LayoutIntents`（activate / close / fold / resize / reorder）改变布局，不直接写 store；
- chrome 若占用空间，必须声明 `metrics`，layout 在分配 content box 时预留；否则会覆盖内容或破坏 resize。

geometry 节点类型（split / grid / region / stack）不开放给 chrome 扩展；chrome 扩展的是节点周围的控制面，不是新的 layout 算法。

**边框与底部 bar**：

- **边框**是 decoration：`region.frame` anchor + `outline` / `box-shadow`，不占 content box；如果必须占位（border 在盒内），通过 `metrics` 声明 inset。
- **固定高度的底部 bar** 是 occupied chrome：`region.footer` anchor + `metrics.blockEnd`；layout 在分配 content box 时扣除，split / sash 计算包含它。
- **全 frame 的状态栏** 是 frame shell 的 footer，不是某个 region 的 chrome；它在 `Space` 之外，统一减少 viewport 高度。
- **可 resize / 可折叠的底部面板** 不是 chrome，而是 layout 的一个 region / node；它需要自己的 surface、sash、persistence。

## 5. Chrome

- frame chrome：title bar、dock、panel、Space switcher、window group tab strip 的外框；
- window group 的 tab strip 内容由 `ui-window` 提供；
- widget board 的 header / actions 由 `ui-widget` 提供；
- frame 不画 widget 内部 header，也不画 app window 的 breadcrumbs；
- actions 在 window group tab strip 右端，由 frame 渲染 adapter 的 action model。

## 6. 持久化

- `Space`、grid placement、track weights、region collapse / maximize、surface kind 属于 frame persistence；Space 按 project folder（workspace）分区，对齐 VS Code 的 workspace storage；
- window group 的 window order / active 属于 window persistence；
- board 的 widget placement / active 属于 widget persistence；board root 的 layout 随 board window 持久化；
- 迁移旧 `views` / `viewGroups` 数据时，按 surface kind 拆成 window / widget 两套记录。

## 7. Decisions

- 几何层 split / grid / region / sash / track / resize 保持不变。
- stage cell 的 surface 是 window group；sidebar / panel 的 surface 是承载 board window 的 window group。
- grid 支持 max / priority / Sizing / snap / maximized；默认 Sizing = Distribute。
- frame 只认 surface registry，不 import window / widget。
- window group / board 的 active 是 surface 内部状态。
- 外层与 board 内容共用 LayoutEngine；board root 是 window content 的 layout hole。
- 跨 board 拖拽是 move；split 只在目标 board root 内发生。
- frame chrome 与 window / widget chrome 分层，不互相画。
- 包归属：`prac-client-ui-frame` 是 DSH 插件行；model / renderer / chrome 在 `prac-ui-kit-workbench`；window / group 模型在 `prac-ui-kit-workbench`，window manager 在 `prac-client-ui-frame`。

## 8. Open questions

- 旧持久化 key 是否仍在 `v1`；旧数据是否自动迁移。
- Space / layout 按 workspace 分区后，旧的全局 `prac-layout/v1` / `prac-spaces/v1` 迁到哪个 workspace，还是丢弃；是否需要一次迁移。
- `flex` 退场后，默认区域比例 / 固定高度是否都能用 size / min / max 表达。
- `visible` 与“空区域不渲染”的统一规则。
- 是否需要在 frame 层支持键盘 track resize。
- surface kind 是否允许运行时替换（window group ↔ board），还是只允许同 kind 重挂。

## 9. Validation

- 同轴三块：拖一条边 ⇒ 三块按比例变，任一块 ≥ min 且 ≤ max，另一轴不动。
- 中心 priority：窗口变小时中心最后让位。
- sash 拖到边缘 ⇒ 该 region 收起、空间按 Distribute 分出去；拖回恢复。
- stage cell 是 window group；sidebar / panel 是承载 board window 的 window group；tab 是 window，不是 widget。
- board 内部 split / resize / 跨 board move 与 frame 外层使用同一套 layout 手势。
- inactive window / board 移除内容根后，重新激活恢复 layout / focus / scroll。
- 刷新后屏幕与状态一致：rows / columns / weights / collapse / maximize 恢复。
- 包依赖 gate：`prac-client-ui-frame` 不 import `prac-client-ui-widget` / `prac-client-vscode-host` / `prac-client-dsh-host`。

## 10. Related

- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：组合模型 / package architecture。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：surface / isolation。
- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：window group 的 editor runtime。
- [2026-10-17-stack-view-chrome.md](2026-10-17-stack-view-chrome.md)：stack / widget header 的标题归属。
