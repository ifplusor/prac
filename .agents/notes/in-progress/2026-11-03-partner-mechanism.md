---
status: in-progress
---

# Agent Note: partner 机制（VS Code 与 DSH 作为基座伙伴）

> VS Code 与 DSH 是 prac 的两个基座伙伴：它们各自贡献 app 与 widget，prac 只拥有组合。共用机制是一个 `PracPartner` 契约 + 一个把贡献投影成注册的 runner，加一层只由 app 打开 window 的 application 层。frame 只保留 `prac.widget` 一个内容座位（window 的内容由 app 提供），加一个由伙伴持有的渲染位置（范围见 Open questions 4），不认识任何来源。

## Problem

`ui-vscode-views` 与 `ui-vscode-editor` 已经写了同一个循环的两份拷贝：`catalogue()` 过滤 → `onDidChangeCatalogue` 订阅 → 逐条 `slots.register({ name: "prac.widget" | "prac.window", id, label, icon, paneHeader }, host.hostFor(id))` → 条目消失时 dispose。两者只差三处：过滤条件、槽名、以及 `ui-vscode-views` 多包一层的 `ViewWithTitle`。

DSH 侧要做的第三份拷贝还做不到，因为 DSH 的内容渲染另有约束：`renderSlot` 的授权跟着**声明该 slot 的那次注册**走（`boundRenderSlot(host, entry)` 检查 `entry.children` 与 `isLive(entry)`），而 `main` / `sidebar` / `rightbar` 现在是 frame 的 `root` 注册声明的。于是 DSH 只能走「frame 特判 `dsh:` 并渲染」这条与架构相悖的路——frame 的文档说它不认识来源，实际它认识三种 `dsh:` 形态。

application 层还不存在：window 记录里只有 `appId` 字符串（`prac.board`、上游 id），没有 app 定义、没有「window 只能由 app 打开」的执行点——今天每个适配器直接注册 `prac.window` 条目，等于把 window 当成了来源的单位。

同时动作还有三个平行座位（`prac.viewActions` / `prac.windowActions` / `prac.widgetActions`，其中两个零生产者）：它们与内容注册是两条独立的生命周期，靠同一个 id 对齐，属于**注册同步靠约定**的那类设计。

## Proposal

### 1 `PracPartner`：伙伴向 prac 贡献什么

伙伴**有且只有两个**：VS Code 与 DSH。每个伙伴是**一组插件**，不是一个插件：`ui-vscode-views` 与 `ui-vscode-editor` 都注册为 `"vscode"` 伙伴的 provider，DSH 的 host 注册为 `"dsh"` 的 provider。runner 按 name 归组，但不把不同插件的贡献当成不同伙伴——`ctx.pracPartners.partners()` 只应列出 `vscode` / `dsh`。

VS Code 与 DSH 是 prac 的两个**基座伙伴**：它们向 prac 贡献功能（views / slots 与它们的内容），prac 只拥有组合。

```ts
interface PracContribution {
  readonly id: string;                     // 全局 id（vscode:* / dsh:*）
  /** app = 打开后成为 application window；widget = 进 board 的可组合单元。
   *  window 是 prac 的**实例**，不是伙伴贡献的单位。 */
  readonly kind: "app" | "widget";
  readonly label?: string;
  readonly icon?: string;
  readonly paneHeader?: boolean;           // 内容自带原生 header，frame 不再画一行
  /** 该贡献自己的动作；随注册进模型，不另立座位 */
  readonly actions?: () => ReactNode;
}

interface PracPartner {
  readonly name: "vscode" | "dsh";                          // 两个基座伙伴；一个伙伴可由多个插件注册
  contributions(): readonly PracContribution[];            // 现在贡献了什么
  onDidChange(listener: () => void): () => void;           // 何时变
  /** 一项贡献的内容。每次**注册**解析一次，不在每次渲染时调用。 */
  hostFor(id: string): () => ReactNode;
  /** 来源特有的包装（如观察 pane header 标题）。 */
  wrap?(contribution: PracContribution, host: () => ReactNode): () => ReactNode;
}
```

`hostFor` 每次注册解析一次是硬纪律：`hostFor` 可以返回新组件，按渲染解析会让整棵视图（以及它的 header）每次重挂。

准入条件：伙伴贡献的是内容（进 prac 的 item 模型），行为走 Cordis service；不提供第二条值通道。

### 2 runner：把贡献投影成注册

`registerContributions(ctx, partner)`：`inject` 座位 → 订阅 → diff → 对每条贡献，`app` 走 application 层（见 §3），`widget` 注册进 `prac.widget`（options 带 `id` / `label` / `icon` / `paneHeader` / `actions`，组件是 `partner.wrap?.(contribution, host)`）→ 条目消失或名字变化时 dispose 并重注册。

它**不拥有** placement、region、几何、active；它不缓存目录，只对齐注册与伙伴。

### 3 application 层：window 只由 app 打开

伙伴贡献的是 **app 或 widget**，window 是 prac 的实例。app 层落在 `ui-frame`（它拥有 window 记录、placement 与内容注册）：

```ts
interface PracApplication {
  readonly id: string;                      // "editor" | "chat" | "board"
  readonly label: string;
  readonly instances: "single" | "multi";   // chat 单实例；editor 每文件一个
  readonly defaultRegion?: string;
  /** 一个 window 实例的内容；按 window id 解析。 */
  content(windowId: string): () => ReactNode;
}

interface PracApplicationsFace {
  register(app: PracApplication): () => void;
  open(appId: string, options: {
    readonly windowId: string;              // 全局 id（vscode:file:… / dsh:main:…）
    readonly title: string;
    readonly instanceKey?: string;
    readonly region?: string;
  }): string;
  close(windowId: string): void;
  windows(appId?: string): readonly PracWindowInfo[];
}
```

`open` 只做两件事：校验 app 定义、把新窗口交给**窗口管理器**（见 §4）。窗口的归属（进哪个 group）、放置（哪个 region）、active 与内容绑定都由管理器负责——app 层不知道 group 的存在。

因此 `kind: "app"` 的贡献**不自己注册** `prac.window` 条目：它 `register(app)`，然后在目录变化时对每个实例 `open` / `close`（editor 按文件 placement，chat 按会话）。`kind: "widget"` 的贡献仍直接进 `prac.widget`。

### 4 窗口管理器：window 的归属、放置与 active

```ts
interface PracWindowManager {
  /** 接收一个由 app 打开的窗口，决定它进哪个 group、放在哪、是否 active。 */
  admit(appId: string, options: {
    readonly windowId: string;
    readonly title?: string;
    readonly instanceKey?: string;
    /** 来源建议的落点；管理器有最终决定权。 */
    readonly region?: string;
  }): PracWindowInfo;
  close(windowId: string): void;
  move(windowId: string, groupId: string, index?: number): void;
  activate(windowId: string): void;
  windows(appId?: string): readonly PracWindowInfo[];
  groups(): readonly PracWindowGroupInfo[];
  onDidChange(listener: () => void): () => void;
}
```

职责边界：

| 谁 | 负责 |
| --- | --- |
| app | 身份（id / label / single-multi / 默认 region）、`content(windowId)` |
| **窗口管理器** | window 记录、**group 归属**、放置、active、关闭回收；内容按 `appId` 从 app registry 解析（不另注册条目） |
| frame | 渲染：group → tab strip、window → 内容、region → 几何 |
| 伙伴 / 适配器 | 只 `open` / `close` / `move` / `activate`，不碰 group 与 placement |

这条边界把今天分散在 `WindowGroupAdapter`、`ui-vscode-editor` 的 `mapWindow`、arrangement 里的 window 逻辑收进一个服务；`mapWindow` 这类上游投影留在适配器侧，作为管理器事件的消费者。

### 4.1 board 是 window，不是 group

board 仍然是 **widget 的容器**：`BoardContent` 持有 widget 的 order / active / split 与 board 自己的 chrome，这部分不变。变的是它与 window 的关系：

- board 是一个 **window**（内容是 `BoardContent`），由 `ui-widget` 贡献的 `prac.board` app 打开；
- 一个 region 只有一种 group：region 的 **window group**，成员是 window（board window、editor window、其他 app window）；
- 不存在「board 自己的 group」，也不存在 `board.hostedWindows`；window 的 group 归属由窗口管理器的放置动作维护（放置/移动到某 region 后，按最近的祖先 group 加入），不靠投影反推；
- 投影（`PracWindowInput` / `mapWindow`）只读窗口管理器的记录（window → region / group / active），不读 group order。

这条模型同时解掉三处耦合：`board.hostedWindows`、`syncBoardWindowProjection` 的 `hostedRegion` 反推、workbench 里 conversation 的 `mapWindow`。

### 5 内容座位由谁写

`prac.window` **保留，但只由 application 层写**：app 的 `content(windowId)` 与它声明的 chrome 事实由窗口管理器在 `admit` 时注册成一条 `prac.window` 座位，`close` 时回收。伙伴不再直接注册它——座位是 frame 的渲染登记表，不是伙伴的 API。

（早先的设计是「删掉座位、frame 直接渲染 app 内容」；实测删掉后 `verify-file` 的八项投影断言全红，根因是 frame 的目录/投影仍以座位为准。座位因此降为内部实现，等 frame 的渲染路径完全由 app 层接管后再评估删除。）

- `prac.widget` 保留：widget 是伙伴的贡献，内容由 board 渲染器按 id 派发（`renderSlot("prac.widget", {}, { only: id })`），board 与 frame 是两个渲染器，这条派发路径不归 app 层；
- 来源渲染位置（暂名 `prac.source`）：适配器声明自己渲染哪些子槽的位置。DSH 在这里声明 `main` / `sidebar` / `rightbar`；
- frame 删除 `DSH_*` 词汇、`viewKind` 的 `"dsh"` 分支、`renderDshView`，catalogue 不再读 DSH 键；
- item 的 body 需要盒子尺寸时，由 frame 通过 box context 给出（DSH 的 sidebar / rightbar 用它，VS Code 的 pane 自量）。

因此 frame 的 item 来源变成三处：窗口管理器（window，内容经 app）、`prac.widget`（widget，内容经 slot 派发）、DSH 宿主（迁移期内的三个子槽）。`ItemRecord.kind` 仍是 `window | widget`。

### 6 两个实例

| | `prac-client-vscode-host` | `prac-client-dsh-host`（原 `ui-dsh`） |
| --- | --- | --- |
| 角色 | 机制宿主：boot / part host / pane；发布 `ctx.pracVscode`（一个 `PracPartner`） | DSH 宿主：声明并渲染 `main` / `sidebar` / `rightbar`；发布自己的 `PracPartner` |
| 来源 | 应用视图注册表 + 打开的文件 | slot registry（`main` 每个 key、`sidebar`、`rightbar`） |
| 变更 | `onDidChangeCatalogue` | `ctx.slots.subscribe("main")` |
| 适配器 | `ui-vscode-views`（widget 贡献）、`ui-vscode-editor`（editor app） | 同一个包内的 `registerContributions` |

### 7 动作

`PracContribution.actions` 随注册进 options，落到 item 的 facts，frame 在 chrome（tab strip / widget 行）渲染它。

- 删除 `prac.viewActions` / `prac.windowActions` / `prac.widgetActions` 三个座位和 kit 的 `ItemActions`；
- 同一 owner 的内容与动作天然同生命周期（同一条注册）；跨 owner 贡献不再有座位——需要动作的 item，由拥有它的伙伴声明；
- 适配器解析出的 resolved action model（`ctx.pracWindowActions`）是另一条通道，不受影响。

### 8 命名

`ui-dsh` → **`prac-client-dsh-host`**：两个来源各有一个 `<source>-host`，`ui-` 前缀留给 UI 表面插件。迁移必须包含本地 profile 的重新 link（`pnpm profile:link`），否则 rig 起不来。

## Migration

1. **application 层 + 窗口管理器**（kit + `ui-frame`）：`PracApplication` / `ApplicationRegistry`（含单测）→ `ctx.pracApplications`；`PracWindowManager` 接管 window 记录、group 归属、放置、active（`WindowGroupAdapter` 的内核上移为服务）。此步不改变现有行为，只建立边界。
2. **editor 成为 app**：`ui-vscode-editor` 从「按 placement 注册 `prac.window`」改为「贡献 editor app + 按 placement `admit` / `close`」；管理器负责写座位与回收；`mapWindow` 退化为管理器事件的消费者。判据：live gate 的 `file` / `editor:*` / `tabs` / `board` 全绿。
3. **合流**：抽出 `PracPartner` + `registerContributions`；`ui-vscode-views` 变薄壳；editor 的 app 贡献走同一契约。
4. **DSH 成为 host**：声明 DSH 子槽、实现 `PracPartner`（chat 为 app，sidebar / rightbar / main keys 按 kind 贡献），删 frame 的 `dsh:` 路径。
5. **动作收口**：三个动作座位与 `ItemActions` 删除。
6. **改名**：→ `prac-client-dsh-host`；重新 link profile；跑 live gate。

每步单独提交；步骤 1 不混行为变更。

## Drawbacks

- 多一层间接：读一个适配器的代码要从 `PracPartner` 实现和 runner 两处看；来源特有的怪癖（`ViewWithTitle`、几何）被挤进 `wrap` 与 box context。
- 来源座位给 frame 引入一个新概念（「问来源要内容」），它本身也可能被滥用成万能逃生口。
- 步骤 2 依赖一个未验证的假设（见 Open questions 1），失败就要退到另一形态。

## Open questions

1. **DSH 内容渲染的形态**（决定步骤 4）：
   - V2：`prac-client-dsh-host` 在自己的座位注册里声明子槽，拿到绑定的 `renderSlot`；window 的 body 用它渲染 `main` 内容。结构上允许（绑定是闭包，校验 `isLive(entry)` 与 `entry.children`，不依赖 React context 位置），但 outlet 是否依赖渲染位置（scope / 顺序 / 卸载清理）未验证。
   - V1：body 不由适配器给；frame 对没有内容的 item 渲染来源位置，适配器在**自己的位置**渲染 DSH 内容。一定安全，但 item 的「内容」归属变模糊。
   - 关闭条件：一个最小 spike（座位里声明 `main`，在一棵由 frame 渲染的子树里调用该绑定，观察渲染 / 切换 / 卸载与 console），通过则 V2，否则 V1。

2. **conversation 的「bring forward」动作去留**：它是产品动作而非伙伴动作。候选：(a) 删除（recall 面已能 show/hide）；(b) 由 frame chrome 提供通用 affordance；(c) 由 dsh-host 的 entry 声明（名不正）。当前倾向 (a)。

3. **runner 的落点与命名**：需要同时被两个伙伴的插件使用，又必须 DSH-free（结构化 `SlotRegistry` face）。候选：`packages/lib/ui-kit-source`（新），或并入某个现有 lib。关闭条件：确定包与名字后写进 `docs/client-packages.md` 的包表。

4. **来源渲染位置是否也承载 vscode 的内容**：VS Code 的内容由 `hostFor` 提供，不需要位置；只有 DSH 需要「声明子槽 + 渲染」的宿主能力。若 V2 成立，位置可能只需要给 DSH。

## Validation

- 步骤 1：live gate 全绿；同一份临时探针在改前 / 改后读 `slots.entries("prac.widget")`，id / label / icon / paneHeader 集合逐条相等；`prac.window` 的条目数在改后为 0（座位已删）。
- 步骤 2：frame 源码不再出现 `dsh:` 字面量与 `DSH_*`；live gate（含 `views` / `file` / `editor:*` / `tabs`）全绿；`pnpm verify:entries` 通过。
- 步骤 4（board 模型）：`BoardWindowAdapter` 不再有 `group` / `hostedWindows`；`board window` 是 `prac.board` app 打开的 window；`containers` 的「editor window in the sidebar WindowGroup」断言改为读窗口管理器的 group 成员；`syncChat` 的 `mapWindow` 删除后 `file` / `containers` / `board` 全绿。
- 步骤 3：三个动作座位在源码与 `SlotMap` 中消失；带 actions 的 item 在 tab strip / widget 行渲染出动作；不带的不渲染。
- 步骤 4：bundle 行按新 id 加载；`pnpm profile:link` 后 rig 起得来；`dsh-types` 比较通过。
- 全程：`pnpm build` / `test` / `check`（本次改动范围）/ `verify:ui`。

## Related

- [2026-10-20-ui-framework.md](../in-progress/2026-10-20-ui-framework.md)：包分层、包表、frame 与来源的边界；本文改它的 `ui-dsh` 角色与动作条款。
- [2026-09-13-vs-concept-boundary.md](../in-progress/2026-09-13-vs-concept-boundary.md)：「包名允许来源词」与 adapter 只翻译的边界；本文关掉其中「是否保留来源词」的开放项。
- [2026-10-12-dsh-anchor.md](../in-progress/2026-10-12-dsh-anchor.md)：「键由拥有者声明」——DSH 三个键的 owner 将从 frame 变为 dsh-host。
- [2026-10-17-stack-view-chrome.md](../in-progress/2026-10-17-stack-view-chrome.md)、[2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：动作通道的分工，本文把它们收敛到 item 注册。
- [2026-10-17-vscode-host-architecture.md](../in-progress/2026-10-17-vscode-host-architecture.md)：VS Code 侧作为实例 1 的现状描述。
- [2026-11-02-client-package-convention.md](../resolved/2026-11-02-client-package-convention.md)：包形状（一个 loader 入口、无 `./lib`、无跨包 value import），本文的 runner 落点必须满足它。
- DSH checkout：`packages/client/ui-slots/src/index.ts`（`StoredEntry` / `children`）、`packages/client/ui-renderer/src/client/scoped-slots.tsx`（`boundRenderSlot`）、`packages/client/AGENTS.md:36-44`（`/client` 即公开 API、feature plugin 不得 runtime-import 别的插件值）。
