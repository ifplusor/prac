# VS Code 的视图进 prac —— 工作记录（依据）

> **这不是 note**：它是这项工作（[2026-10-06-vscode-view-catalogue.md](../../notes/abandoned/2026-10-06-vscode-view-catalogue.md)）的**依据**——实测清单、上游注册点、踩坑。
> 没有状态轴、不签字。

## 可借用的东西：按**上游注册点**分类

> 划分依据是"它在上游是什么、在哪注册"，不是我们的想象。每一类都注了出处。

### A. 视图容器里的视图（`IViewDescriptorService`）

**实测清单**（真 rig `:3084`，新 face 的 `listViews()`；`.build/scratch/exp14-catalogue.mjs`）：**15 个 active 视图 / 10 个容器 / 3 个位置**。

| 位置 | 容器 | 视图 |
| --- | --- | --- |
| sidebar | Explorer（`workbench.view.explorer`） | Open Editors · **Folders**（`workbench.explorer.fileView`）· Outline · Timeline · **Probe Webview**（`pracProbeWebviewView`，扩展贡献的 **webview** 视图） |
| sidebar | Search | Search |
| sidebar | Source Control | Changes |
| sidebar | Run and Debug | Run（`workbench.debug.welcome`，**welcome** 型） |
| panel | Debug Console | Debug Console |
| panel | Problems | Problems |
| panel | Output | Output |
| panel | Terminal | Terminal（`terminal`） |
| panel | **Spell Checker**（`workbench.view.extension.cspellPanel`） | File Issues · Issues（**扩展贡献的 tree 视图**） |
| auxiliarybar | **Chat**（`workbench.panel.chat`） | Chat（`workbench.panel.chat.view.copilot`——**另一个 agent 的界面**，已定"留着不显示"） |

- **枚举面**：`IViewDescriptorService`（`src/vs/workbench/common/views.ts:612`）→ `viewContainers`、`getViewContainerModel(container)`、`getViewContainerLocation(container)`、`onDidChangeViewContainers`。
- **三层集合**（`viewContainerModel.ts`）：`allViewDescriptors`（注册集；事件只在注册/注销触发）、`activeViewDescriptors`（`when` 成立集；模型自己订阅 context key，:339/:593-624）、`visibleViewDescriptors`（active ∧ 用户没隐藏；**容器实际排布的那批**，:662-674）。
- **上游各自的消费者**：`all` → 选择器（View Quick Access 自己再用 `contextMatchesRules(view.when)` 过滤，:104-106）／移动重置菜单；`active` → 容器空不空、activity bar 图标、viewlet 渲染哪些、`viewsService` 判在不在（:191/:228/:308）；`visible` → **splitview 的排布、尺寸、顺序**（`viewPaneContainer.ts:518,717,739`）。
- **挂载**：face 的 `mountViewInto(viewId, element)` —— 给**单个视图**建 pane（`ViewPane.render()` + `.monaco-pane-view` 外层外壳），不经过容器；未注册的视图会被**延迟重试**。`releaseView(viewId)` 释放。

### B. 部件（`Parts` 枚举，10 个）

`titlebar` · `banner` · `activitybar` · `sidebar` · `panel` · `auxiliarybar` · `sessions` · `customViewGrid` · `editor` · `statusbar`（`src/vs/workbench/services/layout/browser/layoutService.ts:21-32`）。

⇒ 已定：**部件是可选的高级形态**，不是组合的单位（`docs/architecture.md` §3.1）。

### C. 编辑器（编辑器服务）

- **一个文件一个视图**：已走通（face 的 `mountFileInto(resource)`，`CodeEditorWidget` + 工作台自己的文本模型）。
- 其余同在一处的：**diff 编辑器**、**custom editor**、**notebook**、**webview panel（编辑区的 webview）**、设置 / 快捷键这类编辑器区的 UI。
- 设计已定的单位是**一个文件一个视图**（`docs/architecture.md` §3.2）；其余的归属**未逐个裁定**。

### D. 框架级浮层（不属于任何视图）

- **quick input**（命令面板 / 快速打开）：挂 `layoutService.activeContainer` 下、用 `getBoundingClientRect` 定 top/left（`platform/quickinput/browser/quickInputController.ts:122-164,956`）。
- **右键菜单**：`IContextViewService.showContextView(delegate, container?, shadowRoot?, …)`（`platform/contextview/browser/contextViewService.ts:30-44`，默认容器 `container ?? layoutService.activeContainer`）。
- **通知 / 模态框**、**悬停 / 补全列表**（生在视图内）。
- ⇒ 已定：按**作用域**分——全局的归框架的悬浮层，视图内的自闭环。

### E. 只做显示、不是 view

状态栏条目、装饰、进度、面包屑、badge。⇒ 不进视图目录。

## 已核实事实（机制侧）

- **上游有两级**：容器（分组 + 自带 chrome：activity bar、容器内 tab 套 stack）与视图（可单独摆的 pane）；**挂载路两条都不依赖容器**。
- **`prac.view` 支持运行期增删**（`slots.register` 返回 disposable；后注册的条目无需 reload 即被提供）。
- **借用件的浮层容器不住视图影根**：`#vscode-embed-boot` 挂在 `document.body`（0×0），`.monaco-workbench` 在它里面，只有**部件**被搬进视图影根（实验 10/13）。
- **新增的枚举面**（本次）：契约 `ViewCatalogueEntry` + `listViews()` / `onDidChangeViews()`，实现遍历 `viewContainers` 取 **`activeViewDescriptors`**，订阅容器增删与每个容器模型的 active 变化。`vscode:build` 绿、embed lib 49/49 绿。

## 落地：目录驱动的视图 + 容器层（2026-10-07 已做）

**做了什么**：机制把两份上游服务收敛成一份目录（`catalogue()` + `hostFor`）；两个消费者包按 `source` 注册 `prac.view`（`ui-vscode-editor` / 新增 `ui-vscode-views`，`ui-vscode-explorer` 退役）；编排按 `containerId` 把借来的容器落成**选一的具名子区域**（`left` = `sidebar`/Explorer/Search/Source Control，`bottom` = Debug Console/Problems/Output/Terminal/Spell Checker），并在区域头部渲染**容器条**；区域树扩成"孩子可以是区域、模式作用于孩子"。

**读数**（rig `:3084`，`.build/scratch/exp15`–`exp21`）：

| 检查 | 读数 |
| --- | --- |
| 目录 | 15 条（真 rig，装了 cSpell + 探针扩展） |
| 默认编排 | `left` 显示 `left/dsh:sidebar`（prac 自己的在前）；借来的容器各一个子区域；`bottom` 显示第一个容器 |
| 容器条 | `left`：`sidebar`(活动) · Explorer · Search · Source Control；`bottom`：Debug Console(活动) · Problems · Output · Terminal · Spell Checker |
| **切换** | 点 `Explorer` → 活动项与该区域显示的子区域都换成 Explorer |
| **扩展贡献的视图上屏** | Explorer 容器里渲染出 `pracProbeWebviewView`（webview 类型的扩展视图），画面见 `.build/scratch/exp21-explorer.png` |
| 排除名单 | Copilot 的 Chat、`workbench.debug.welcome` 未上屏（`region: null`, hidden） |

**踩的坑**：`regionStyle` 有**两处调用**（选择分支与叶子分支），我第一版只给选择分支传了 `fill`，于是"选择区域的孩子是叶子"时盒子塌成 0 高——`left/dsh:sidebar` 内容在、高度 0。教训：**同一个计算被多处调用时，改一处等于没改**（与"契约的消费者要枚举全"同型）。

**闸门迁移（B8，已做）**：五道红的门都按容器模型改了，**十一门全绿**（vendor 六 + prac 四 + cSpell 条件门）。逐门的处置：

| 门 | 为什么红 | 改法 |
| --- | --- | --- |
| `verify-stack` | `left` 现在是选择区域，直接放进去的视图落到它自己的子区域 | 运行时**发现**承载视图的那个容器子区域，在它里面叠；补一条"容器条有名、只有一个活动"的断言 |
| `verify-bottom` | 底栏默认被容器的视图填上 | 先**等到编排落定**、再把底栏的视图全部 `hide`，然后验"空则不在"；断言改为只看顶层区域 |
| `verify-persistence` | key 从 v1 升到 v2；基线变了 | 升 key；基线改成"顶层区域 + 侧栏默认宽"；动作改为**选中 Explorer 容器并折叠它里面的视图**；补 **`containerRestored`**（容器选中是新状态） |
| `verify-split` | 分栏的对象/前提变了 | 拆分改用**工作区**的视图（容器内不分栏）；列轴拖动改用**框架自己的**列 sash（工作区内新分栏是 flex+flex、没有可抓的边），并说明精确算术归单测 |
| `vendor verify-layout.defaultRegions` | 顶层区域多了 `bottom`、且各轨有了子区域 | 只比**顶层**区域。 |

**同时修掉两个真 bug**（都是容器层引入的）：

1. **`place` 的 reveal 目标错了**：`placeQuietly` 会把视图路由进子区域，但 `revealRegion` 用的还是**原区域 id**，于是"放进去却没显示"（`verify-view` / `verify-regions` 超时）。改为揭示**落点**区域。
2. **目录同步把用户隐藏的视图重新显示**：`placeCatalogue` 每次同步都无条件 `placeQuietly`（它会把 `hidden` 置回 false），违背"只填空缺"。改成只对**还没有记录**的视图落位。

**一条留给产品的事实（不是 bug）**：视图若在**编排建好容器之前**被放进某个轨，会被救回"它自己的子区域"而**不被选中**（`left` 会先有 `dsh:sidebar`，所以默认屏不受影响）；`verify-view` 因此先等编排落定再动。真要覆盖这个窗口，得让"放置"在区域还不是选择区域时也记住意图——现在没有这个需求。

## 普查 + 留下活体门（2026-10-07，B10）

**普查（`.build/scratch/exp26`–`exp29`，rig `:3084`）**：切到每个容器、看它的每个视图有没有内容。

| 轨道 | 容器 | 视图读数 |
| --- | --- | --- |
| `left` | prac 自己的 `sidebar` + Explorer · Search · Source Control | Explorer **5/5** 上屏（fileView、openEditors、outline、timeline、探针 webview）；Search / SCM 各 1/1 |
| `bottom` | Debug Console · Problems · Output · Terminal · Spell Checker | 各 1/1（Spell Checker 2/2） |

合计 **13 条借来的视图落在 8 个容器**里，每条都有 `[data-prac-view-host]` 且高度 > 0；容器条读数与编排建的具名子区域逐一对应（`left` 4 项、`bottom` 5 项）。排除名单仍是"**登记但未放置**"（`region: null`、`hidden: true`）。

**一次误报，值得记**：普查第一眼看到 Explorer 容器的 5 个视图**同时**各占 147px（5×147≈734），我判为"容器没做到一次一个"。查 `frame.ts` 才确认**这正是 VS Code 的语义**：侧栏视窗的段是**纵向堆叠**（Explorer 里确实是 文件树/打开的编辑器/大纲/时间线 并存），**面板**才是选项卡式选一。prac 的容器层把这两级都表达对了——**轨道在容器间选一，容器内按自己的模式排视图**。教训：渲染层的"看着不对"要先落到模式语义上再判，否则会把上游的正确语义当成 bug 修掉。

**新门 `verify:containers`（10 条断言）**：条上可切换、点击后**只**渲染被点的那个子区域（对 8 个容器逐一真实点击）、容器自己不生容器条、容器里每条视图都有 host 且高度 > 0、七条借来的 IDE 面都在、所选容器**画得出像素**、排除名单仍登记未放置、无 prac 侧控制台错误。

**伪造（证明这门不空转）**：把 `renderRegion` 的选择分支临时改成渲染全部子区域 → 重建 + 重启 rig → 该门**只在 `one container at a time` 上变红**、其余仍绿；回滚后复绿。

**门内修掉的一个自己的错**：像素质计数放在切完一圈之后量，那时 Explorer/Problems 已不在屏上，读数 0（"结构性存在、视觉空白"的假阳性）；改成量之前先切回去。同一处补了**出厂形状**起点（清 key + reload）——门共用一台 rig，前一个门留下的放置/隐藏/选中否则会决定后一个门看到什么。

**留下的账（同前，未动）**：借用件的浮层路由（局部进视图根、全局交框架）仍未落地；容器条的样式与键盘可达未做。


