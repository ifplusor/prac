# UI surface map（参考）

> 两个生态的 UI 贡献面 → prac 的格子，以及 UI 术语表。决策与理由见 [2026-10-20-ui-framework.md](../.agents/notes/in-progress/2026-10-20-ui-framework.md)；本文只做参考映射，不承担决策。

## 1. VS Code

| 贡献面 | 上游形态 | prac 的格子 | 第一版 |
| --- | --- | --- | --- |
| `views`（tree / webview view） | `ViewPane` / `WebviewViewPane` | **view**；host 是 `view-pane`；`containerId` 只是默认落位提示 | 是 |
| `viewsContainers`（activitybar / panel / secondarySidebar） | `ViewContainer` + `IViewContainerModel` | **container declaration**：提供 id / title / icon / location / order / hideIfEmpty；prac 的 container 默认 stack；成员由 placement 决定，不由 `ViewContainer` 拥有 | 是 |
| `viewsWelcome` | tree view 的空状态内容 | **view 级空态**，留在 view 的 host 里 | 是 |
| `view/title` / `view/item/context` / `editor/title` / `editor/context` / `menus` | 菜单项引用命令 | **action**；view / container / global，或 source-owned 浮层里的菜单 | 是 |
| `commands` / `keybindings` | 命令与键位注册表 | **command / keybinding**，不是 view | 是 |
| webview panel / `customEditors` | editor part 里的 tab / group | **view**；host 是 `editor-pane`；组 / 区域归 source runtime | 第二版 |
| 状态栏 `window.createStatusBarItem` | `StatusbarPart` 的 item | **part item**，不是 view | 以后 |
| 通知 / Quick Pick / Dialog / Context View / Hover | workbench 自己的浮层服务 | **frame-hosted, source-managed overlay**；在 frame 的一个浮层里，按 order 排 | 是（现有 float host） |
| completion / webview overlay / 编辑器内 hover / decorations / CodeLens / inlay / comments | view 自己的 DOM / 编辑器实现 | **host-local**；被盒子裁剪是正确行为 | 不建模 |
| settings / keybindings UI / extension details | `EditorPane`（editor tab） | **view（editor placement）**；host 是 `editor-pane`，不是 overlay | 第二版 |
| activity bar | 选 container 的部件 | **part / 容器条**；不继承图标条 | 不继承 |
| themes / icons | 主题服务 | **host token**；frame chrome 的 token 见主题决策 | 第二版 |

**判据**：VS Code 的 UI 不是一个东西，它至少有 **part / container / view / editor / action / overlay / status item / host-local** 八类。prac 只把**可挂载的 view**（含 editor placement）收进目录；part / overlay / action / status item 各自归格，不能都塞进 view。

## 2. DSH

| 贡献面 | 上游形态 | prac 的格子 | 第一版 |
| --- | --- | --- | --- |
| client 插件 `apply` 里注册 `prac.view` | React 组件 + slot entry | **view**；host 是 `react` | 是 |
| DSH 插件声明 container | `pracViews.registerContainer`（目标） | **container declaration**：元数据 / 默认落位；成员由 placement 决定 | 第二版 |
| `sidebar` / `main`（keyed）/ `rightbar` | DSH 的单个 / keyed 槽 | **host slot**：view 的 host kind 是 `slot`；不是 `prac.view` 贡献 | 是 |
| `shell.overlay`（list） | 应用级浮层条目 | **frame-hosted, source-managed overlay**；与 VS Code float host 同一层、按 order 排 | 是 |
| `shell.bottom` / `shell.leading` | 底栏 / 窗口 chrome 座位 | **part seat**；当前不声明，依赖它的插件会停在等待 | 以后 |
| `prac.viewActions` / `prac.containerActions` | 自定义 chrome 的逃生口 | **action slot**；标准 action 仍走数据 | 是 |
| `ctx.layout` / `pracLayout` | DSH 的布局 compat / prac 的放置面 | **placement**；编排调用 | 是 |
| client graph / loader / HMR | 代码到达与替换 | **lifecycle**；frame 只订阅注册 | 是 |
| store / locale / theme / 组件库 | 来源运行时 | **source runtime**；不进入 frame 模型 | 不建模 |

**判据**：DSH 的槽不是“来源”，而是 **host 词表**。`sidebar` / `main` / `rightbar` 由 frame 渲染成 host，不经过 `prac.view`；`prac.view` 是 prac 自己的 view 槽。`shell.overlay` 是浮层，不是 view。

## 3. 两个模型的交集

- **共同点**：都能贡献 view、action、overlay；都有生命周期与“当前可用 / 不可用”。
- **差异点**：VS Code 有 part / container / editor group；DSH 有 frame 槽与单一 host 座位。
- **不在交集里的**：DSH 的 `ui-layout` / AppFrame / 固定列。它不是 view，也不是 prac 的 frame；prac 用自有的布局拓扑 / container / placement 替代它。
- **prac 补上的那一层**：把 VS Code 的 container 变成 prac 的 `ContainerRecord`（具名 view group，默认 stack），把 editor 变成 view + `editor-pane` host，把 DSH 的槽变成 host kind；这样两边的 view 才能进入同一个 placement 模型。
- **混合 select group**：select view group 的 total order 是可见 tab 的唯一顺序权威；frame 画统一 group bar；editor 子集的顺序 / preview / pinned 由 VS Code adapter 同步。

## 4. 术语

本表是 UI 的 canonical 词；`docs/concepts.md` 的旧词表后续同步。

| canonical | 不要用 | 说明 |
| --- | --- | --- |
| **view** | content | prac 可挂载的单元；tree view / React view / editor placement 都是 view |
| **view group** | — | region 的内容根；一组 view，mode 是 `stack` 或 `select`；`active` 只属于 select；不是布局节点 |
| **view group state** | — | 每个 group 都有：id / mode / active / order / tombstone；无名 group 也有；order 是兄弟顺序 |
| **placement** | — | view → viewGroup 的成员边；order / hidden / folded / size；不是拓扑节点 |
| **container record** | container | 只对具名 group 存在；title / icon / location / actions / hideIfEmpty / available |
| **ViewGroupState / ViewGroup** | — | group 的数据面 / 运行时；数据持久化，binding 不持久化 |
| **ViewGroupDefinition / ViewGroupResource** | — | core 的 group CRD / CR 信封；VS Code 具体为 `VscodeViewGroupDefinition` / `VscodeViewGroup` |
| **ViewDefinition / ViewResource** | — | core 的 view CRD / CR 信封；VS Code 具体为 `VscodeViewDefinition` / `VscodeView` |
| **ViewHost** | — | view 的运行时边界：mount / release / focus；`hostKind` 由 source 定义 |
| **MoveIntent** | — | 移动 hint；默认目标先建、源后释放 |
| **container** | group（指 prac 组合单元时） | **具名的 view group，默认 stack**；`editor group` 只在上游出现，不是 prac 类型 |
| **layout topology** | layout tree / region tree | 拓扑可以是 split → grid → region；view group 是 region 的内容根，不是第四个节点；region 位置 = parent + slot（split index / grid anchor+span），rect 由 layout kernel 计算 |
| **split / grid / region / cell** | — | `grid` 是二维节点；`cell` 只在 grid 内使用 |
| **stage** | center stage / center workbench | arrangement 的 role，默认物理位置 center；VS Code 的 workbench 是另一层，不混用 |
| **primarySidebar / secondarySidebar / panel** | left / right / bottom | arrangement 的 role id；显示名分别是 primary sidebar / secondary sidebar / panel；物理方位不是 role 名 |
| **source host kind** | host kind / source-specific kind | 来源自己的 `hostKind` + `ViewHost`；内置示例 `react` / `view-pane` / `editor-pane` / `slot` / `opaque`；core 不枚举 |
| **overlay host** | — | frame 拥有 host / layer / order；behavior 可以是 source-managed 或 frame-managed |
| **source-managed overlay** | source-owned float | `shell.overlay` entry；来源自己定位 / 关闭 / 焦点 |
| **frame-managed overlay** | frame-owned overlay | `pracOverlay`；frame 定位 / 关闭 / 焦点 / 栈 |
| **host-local** | content-local | 留在宿主盒子里的 UI |
| **focus** | attention | focus 是浏览器焦点机械事实；attention 是编排的业务面 |
| **catalogue** | registry | catalogue 是合并后的目录；`registry` 只指 DSH 的 slot registry |
| **source adapter** | — | 观察一个生态、投影成 view / container / action / overlay |
| **arrangement** | composition | 默认落位、角色、container 策略、注意力 |
