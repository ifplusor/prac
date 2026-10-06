# VS Code 的视图进 prac —— 工作记录（依据）

> **这不是 note**：它是这项工作（[2026-10-06-vscode-view-catalogue.md](../notes/in-progress/2026-10-06-vscode-view-catalogue.md)）的**依据**——实测清单、上游注册点、踩坑。
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
