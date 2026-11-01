---
status: in-progress
---

# Agent Note: vscode-host — 把 VS Code 的 UI 贡献翻译成 prac 的资源

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。editor window：[2026-10-07-editor-host.md](2026-10-07-editor-host.md)。widget registration：10-20 §1.5。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

`vscode-host` 是 prac 与嵌入的 VS Code workbench 之间的 adaptor。目标包名是 `ui-vscode-host`；当前实现包名是 `vscode-host`。它做三件事：

1. **翻译** VS Code 的 editor / view container / view 为 prac 的 application / window / widget board / widget；
2. **提供 runtime**：bridge、catalogue、face、ViewPane / EditorPane host、commands / actions / overlay；
3. **注册查找**：让 `IViewsService` / `IEditorService` 找到 prac 管理的 view / editor。

它**不拥有** prac 的 frame、window、widget 布局、active 或 placement。

## 边界

| 层 | 负责 | 不负责 |
|---|---|---|
| **frame / ui-frame** | Space、region、surface、dock rail、sidebar / panel、window group / board 的布局 | VS Code 的 part / container / pane / editor 语义 |
| **ui-window** | window、window group、tab strip、active window | VS Code 的 editor input / ViewPane |
| **ui-widget** | widget、board、`prac.view` / `prac.viewActions` | VS Code 的 container / view 生命周期 |
| **vscode-host（adaptor）** | VS Code 的 editor / container / view / action / overlay / webview 语义；catalogue；binding；host；生命周期 | prac 的 layout / window / widget placement |
| **vendor/vscode-embed** | boot、资产、宿主元素、命令面、bridge | 政策：哪些 view、怎么摆 |
| **vendor/vscode** | 上游 workbench（pin + patch + overlay） | prac 的词与政策 |

关键句：**frame 不认识 VS Code；adaptor 不拥有 frame / window / widget。**

## 1. 映射

| VS Code | prac |
|---|---|
| editor input（文件 / diff / custom editor / webview） | **application window**（editor app） |
| `ViewContainer`（Explorer / SCM / GitLens / Run / Problems / Output / Terminal） | **widget board window**（sidebar / panel / stage） |
| `ViewDescriptor`（Folders / Timeline / Outline / Changes…） | **widget**，带默认 board hint |
| 单 view container | **一个 widget 的 board window** |
| editor group | window group 的 adapter runtime（`IEditorGroupView`） |
| 菜单 / 命令 / action | resolved action model |
| webview / custom editor | `EditorPane`（`WebviewEditor`）；受 webview secure-context 约束 |
| integrated browser | Electron `BrowserEditor`；web workbench 不可用 |
| activity bar / status bar / 全局 UI | frame chrome / dock rail / overlay，不是 window / widget |

VS Code 的 `View` / `ViewContainer` / editor input 是**来源对象**；prac 的 window / board / widget 是**组合对象**。adaptor 只做翻译。

每个 stage window 在 adaptor 侧都有一个 **1:1 `EditorInput` 投影**（editor window 用真实 input；chat / widget window 用自定义 input）；window 仍是 frame 权威，editor group 只是这组投影的 runtime。

## 2. 资源

### 2.1 catalogue

`PracVscodeFace.catalogue()` 输出：

- `source: "file"` → application window（editor input）；
- `source: "view"` → widget + 默认 board hint；
- `location` 只是默认 placement；
- `containerId` / `containerTitle` 是默认 board hint，不是成员所有权。

frame / `ui-workbench` 决定 placement；`containerId` 不能把 widget 拉回来源 container。

VS Code 把 container 里的 view 分三层：`all`（注册集）、`active`（`when` 成立集）、`visible`（`active` 且用户没隐藏）。prac 只注册 **`active`**：`when` 一变就进出 catalogue；不搬 `visible`，否则 VS Code 的显隐会成为第二个“在屏上”的真相源。`hideIfEmpty` 由 board / workbench 决定，不由 catalogue 执行。

### 2.2 widget registration

没有通用 CRD。VS Code 的贡献直接翻译成 typed descriptor：

- `ViewDescriptor` → `WidgetDefinition`（id / source / hostKind / title / icon / defaultBoard / multiplicity / actions）；
- `ViewContainer` → widget board + `BoardBinding`；
- adaptor 注册 `WidgetHostFactory`，按 `hostKind` 创建 `ViewPane` / `EditorPane` / React host；
- `VscodeViewGroupDefinition` / `VscodeViewDefinition` 是当前实现期的工厂名，目标改为 `VscodeBoardBindingFactory` / `VscodeWidgetHostFactory`；
- Application / Window / Board 是组合层，不由 descriptor materialize。

### 2.3 binding

`BoardBinding` 由 board 的 `groupKind` 选择，不由资源 `apiVersion + kind` 决定：

- `groupKind = container` → `ContainerBinding`：board context、widget 集合 / visibility / order / collapse、board title / actions、context keys、focus、drag / drop；
- `groupKind = editor` → `EditorGroupBinding`：window group 的 editor runtime（`EditorGroupModel`、active 投影）；
- 不从 board 内容推断；
- binding 只提供 context / actions / host 入口，不拥有 widget 实例，也不决定 widget placement；
- actions 由独立 action host 提供，挂在 frame 的 window group tab strip 右端；
- binding 不拥有 UI chrome。

board lifecycle：board 创建 → binding 挂到内容组；widget mount → `VscodeViewHost` 注册 external view；widget release → 注销 view，widget definition / placement 由 `ui-widget` 保留；source 卸载但 board 还有别家 widget 时 board 保留；board 关闭 → binding / view hosts dispose。custom editor / webview 仍是 `WebviewEditor` pane，受 secure-context 约束；integrated browser 是 Electron-only，web workbench 不支持。

## 3. Runtime 对象

| 对象 | 作用 |
|---|---|
| `VscodeEmbedHandle` | boot / view / file / placements / views / floatHost / group-cell channel |
| `WorkbenchFace` | mount / focus / release / capabilities；不承载 part mount |
| `EmbeddedWorkbench` | workbench 本体：服务、view / editor runtime、overlay |
| `PracWindowGroupHost` | adaptor 侧 editor runtime：`IEditorGroupsService` / `EditorGroupModel`；一个 window group 一个 editor group（当前实现名；旧名 `PracEditorHost`） |
| `WindowInput`（目标） | 每个 window 的 `EditorInput` 投影；chat / widget 用自定义 input，window id ↔ input 1:1 |
| `EditorWindowModel` / `EditorPaneHost`（目标） | per-window 的数据与 pane runtime；不使用 group 级 `EditorPanes` |
| `EditorWindow` | window 在 adaptor 侧的表示（`ui-vscode-editor`）：breadcrumbs（仅 editor content）+ pane + workbench context |
| `WindowActionModel` | active window 的 resolved action 描述；frame 渲染 |
| `VscodeGroupBinding` | board / window group 的内部内容组 context / actions |
| `VscodeViewHost` | 每个 VS Code view 的 runtime host：mount / release `ViewPane` / `EditorPane`；注册 / 注销 `IViewsService` |
| `PracViewsService` | `IViewsService` 的 external registry |
| `ViewPane` / `ViewPaneContainer` | 上游 widget / board runtime |
| `ui-vscode-views` | widget board + widget adaptor |
| `ui-vscode-editor` | application window adaptor |

## 4. Actions / overlay

- extension 通过 `contributes.commands` / `contributes.menus` 贡献 action；
- adaptor 用 menu service 解析 `MenuId.EditorTitle` / `view/title` 等，应用 `when` / context；
- 输出 resolved action model：id / label / icon / group / order / enabled / checked / submenu / keybinding / tooltip；
- frame 渲染 window group tab strip 的 actions（resolved model）；group header 不再画 editor actions；widget header actions 由 board/widget 渲染；
- 菜单 / 命令面板 / hover / 通知由 workbench 服务创建，走 frame float layer；
- view 内部的补全 / hover / webview overlay 留在 window / widget 内。

## 5. 约束

- 不采用 VS Code 的顶层布局；
- 不把 frame 的 stack / grid 塞进 adaptor；
- 不让 frame 认识 VS Code 的 part / container / pane / editor group；
- 不把 container 的 owner 放回 frame；
- 不暴露 part host，也不把整块 VS Code part 当兜底；
- 不按 core / extension 分 view 渲染路径；
- 不把 core workbench 当普通 extension 重建；
- webview / iframe 的 secure-context / HTTPS / 通配域约束不由 adaptor 绕过；
- 集成浏览器在 web workbench 不可用，不能假装存在。

## 6. Decisions

- `vscode-host` 是 adaptor，不是 frame / window / widget 的 owner。
- editor input → application window；ViewContainer → widget board；View → widget。
- 每个 stage window 在 adaptor 侧有 1:1 `EditorInput` 投影（含 chat / widget）；window 是 frame 权威，projection 是派生。
- editor group ↔ window group 的 adapter runtime；不拥有 UI chrome。
- 没有通用 CRD；widget 用 typed descriptor / host factory，binding 是 board / group context，不是 UI chrome。
- actions 由 adaptor 解析成 resolved model，frame 渲染。
- webview / integrated browser 的可用性按 web / Electron 分别说明。
- 包划分见 10-20：`ui-vscode-host` / `ui-vscode-views` / `ui-vscode-editor`。

## 7. Open questions

- `tabGroups` API 如何映射 / 隔离。
- `ViewContainer` 的 visibility / focus / collapse 与 board active widget 的边界。
- foreign widget 移入 VS Code board、再移出的状态保留规则。
- webview 的 secure-context 部署约束如何暴露给用户。
- custom editor / webview editor 的 action model 是否与 text editor 一致。
- chat / widget window 的自定义 `EditorInput` 的 capabilities / dirty / save / preview / move 语义。

## 8. Validation

- editor input 打开为 application window；ViewContainer 打开为 board / widget window；ViewDescriptor 成为 widget；chat / widget window 也有 `EditorInput` 投影。
- Timeline 从 Explorer board 移到 right sidebar board / stage widget window；source 不变。
- 单 view container 是一个 widget 的 board。
- actions 在 window group tab strip 右端，跟随 active window，不与 breadcrumbs 抢行；group header 没有 editor actions。
- ViewPane / EditorPane 的 lifecycle 与 upstream 一致；webview secure-context 失败可见。
- frame 没有 VS Code 分支；adaptor 没有 frame / window / widget placement 逻辑。
- 包依赖 gate：`ui-vscode-host` 不 import `ui-frame` / `ui-window` / `ui-widget` 的布局实现；adapters 只翻译。

## 9. Related

- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：组合模型 / package architecture。
- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：editor application window。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：隔离。
