---
status: abandoned:superseded
---

# Agent Note: vscode-host adaptor surfaces —— 一张归属图

> **Superseded**：本 note 的 surface inventory 已并入 [vscode-host architecture](../abandoned/2026-10-17-vscode-host-architecture.md) 的 “Surface ownership” 一节；这里只保留为历史。
>
> **这是哪件工作**：`vscode-host` 是 prac 与 VS Code 之间的 adaptor；这张 note 只做**归属图**，把每个 UI surface 的 owner、现有 step、缺口列清楚。umbrella 见 [2026-09-09-vscode-dsh-integration.md](../abandoned/2026-09-09-vscode-dsh-integration.md)。
> **状态**：已由 architecture 取代。这是一张 map，不是设计；具体设计留给各 surface 自己的 step。

## Problem

当前 adaptor 侧只有两个 step：

- [2026-10-07-editor-host.md](../abandoned/2026-10-07-editor-host.md)：编辑器宿主；
- [2026-10-17-vscode-host-view-container-context.md](2026-10-17-vscode-host-view-container-context.md)：view container context。

其余 UI surface 没有 owner：

- part / region；
- action / menu；
- status bar / overlay；
- webview / custom editor；
- 编辑器内容 UI（decorations / hover / CodeLens / Inlay Hints）；
- SCM / comments / timeline / tests / debug / task / terminal / notebook / chat；
- themes / settings / walkthrough。

没有一个 map，后果是每个 surface 都被当成一次性问题：要么漏掉，要么在 container context 里硬塞，要么让 frame 认识 VS Code。

## 设计立场

- **frame**：区域/stack/fold/sash/拖拽；只认 view/region。
- **vscode-host（adaptor）**：承接 VS Code 的 part/container/pane/view/action/overlay/webview/editor 语义。
- **UI 布局模型**（[docs/vscode.md](../../../docs/vscode.md) §3）：frame / part / container / pane / view；editor group 是平行链。
- **扩展 UI 能力范围**（[docs/vscode.md](../../../docs/vscode.md) §4）：扩展只能往声明出来的 surface 里放内容，不能改 workbench chrome。
- **`prac.view` 是 view 的注册缝**；`containerId` 只是元数据；容器是具名子区域，不是 prac 的 owner。

## Surface map

| surface | VS Code 侧 | 谁负责 | 现有 step | 缺口 |
| --- | --- | --- | --- | --- |
| **part / region** | titlebar / banner / activitybar / sidebar / editor / panel / auxiliarybar / statusbar；`Layout`/`Grid` | frame 负责布局；adaptor 负责 VS Code part 语义 | boundary、catalogue、editor host 间接涉及 | 没有 part context；frame 的 part/region ↔ VS Code part 的映射未定 |
| **view container / view** | `ViewContainer` / `ViewPaneContainer` / `ViewPane` / `ViewContainerModel` | adaptor | 本 note 的 container context step + catalogue | headless `ViewPaneContainer` 未验证；`IViewsService` 注册未定 |
| **action / menu** | `ViewTitle` / `ViewContainerTitle` / `commands` / `keybindings` / `menus` | adaptor 提供 action；frame 提供 action slot | stack chrome 部分涉及；container context 涉及 owner | 没有 action/menu context；view/container scope 未定 |
| **status bar / overlay** | status bar item；notifications / quick pick / input / dialog / context view / hover | adaptor 提供内容与容器；frame 提供 overlay 层 | context-view 修复（worklog） | 没有 overlay/status context note |
| **webview / custom editor** | webview view / panel；custom editor | adaptor | editor host；`ui-vscode-views` 的 webview view | webview host / custom editor 的契约未写 |
| **编辑器内容 UI** | decorations / hover / CodeLens / Inlay Hints / semantic tokens | adaptor（编辑器链） | editor host 只覆盖编辑器面板 | 内容 UI 没有独立 owner |
| **专用视图** | SCM / comments / timeline / tests / debug / task / terminal / notebook / chat | adaptor（多数是 view + action；部分是 controller） | 通用 view/container 承接一部分 | 哪些是纯 view、哪些需要 controller/action，未列清 |
| **主题 / 设置 / walkthrough** | themes / icon themes / configuration / walkthroughs | adaptor + frame 的主题/设置面 | 主题投放已落地（boundary） | 没有专门的 themes/settings/walkthroughs 归属 |

## 各组说明

### part / region

VS Code 的 part 是固定集合（titlebar / activitybar / sidebar / editor / panel / auxiliarybar / statusbar），扩展不能新增 part。frame 的 region/part 是 prac 自己的布局；adaptor 只承接 VS Code 对这些固定 part 的语义（哪个 part 在、part 的 title/items/visibility）。

当前缺的不是“再加一个 part”，而是**part context**：frame 的 `left`/`bottom`/`center` 与 VS Code 的 sidebar/panel/editor 如何对应，谁决定 part 的显示/尺寸/标题。

### view container / view

见 [container context note](2026-10-17-vscode-host-view-container-context.md)。它的范围是 **view container / view surface**，不是整个 adaptor。当前倾向 B（headless real `ViewPaneContainer`），先验证 `IViewsService` 注册与 collapse。

### action / menu

action 的 owner 分两类：

- **view-scoped**：`ViewTitle`；view 自己；
- **container-scoped**：`ViewContainerTitle`；container context；
- **global**：commands / keybindings / 菜单；adaptor 的命令面。

现在 stack chrome 只处理 view 行头的 action slot；container 条/菜单、命令面板、菜单贡献还没有归属。

### status bar / overlay

status bar 是 part；notifications / quick pick / dialog / context view / hover 是 overlay。它们由 adaptor 的内容 + frame 的 overlay 层共同承接。

context-view 已做过一次 float-host 修复，但那是一次具体问题；overlay/status 的通用契约还没有写。

### webview / custom editor

webview view 是 view；webview panel / custom editor 是编辑器 tab。它们需要：

- webview host 的隔离/消息/生命周期；
- custom editor 的 `registerCustomEditorProvider` 与 editor group 的配合；
- 与 editor host 的边界。

### 编辑器内容 UI

decorations / hover / CodeLens / Inlay Hints / semantic tokens 不是“视图”，是编辑器 pane 的内容 UI。editor host 目前只解决编辑器面板/组的宿主；内容 UI 需要自己的 adaptor 契约。

### 专用视图

SCM / comments / timeline / tests / debug / task / terminal / notebook / chat 多数是“view + action/controller”。它们可以复用 view/container/action 的通用面，但：

- 哪些是纯 view；
- 哪些需要 controller（debug/test/notebook/terminal/chat）；
- 哪些有独立的 part/panel 语义；

需要逐类列清，不能假设“都是 view”。

## 规划

- **P0（本 note）**：把 surface map 定下来；后续每个 surface 的 note 都挂到这里。
- **P1**：container context（B headless `ViewPaneContainer`）；先验证 `IViewsService` / `getViewWithId` / collapse。
- **P2**：stack chrome（frame 侧）；收 A 的 open：view icon、DSH action slot、action popover、22px/混合栈。
- **P3**：layout grid（frame 侧）；max / priority / Sizing / edge snap。
- **P4**：editor host（adaptor）；编辑器组与内容 UI 的边界。
- **P5**：其余 surface：
  - action/menu；
  - status bar/overlay；
  - webview/custom editor；
  - 编辑器内容 UI；
  - 专用视图；
  - themes/settings/walkthroughs。
- **搁置**：C2 / 决策空间 / 认识论六件事；不排期。

## Open questions

- part context 的最小契约是什么？frame 的 region 与 VS Code part 的对应由谁决定？
- action/menu 的 owner：view-scoped / container-scoped / global 的边界由 adaptor 还是 frame 判定？
- overlay 的内容与容器：adaptor 只给内容，frame 给层，是否足够？
- webview view 与 webview panel/custom editor 是否共用同一个 host 契约？
- 编辑器内容 UI 是否属于 editor host，还是独立 adaptor？
- 专用视图里哪些必须有自己的 controller/action note？
- themes/settings/walkthroughs 是否只是“内容面”，不需要新的 owner？
- 这张 map 的 status：proposed 到 in-progress 的裁点是什么？

## Related

- [2026-09-09-vscode-dsh-integration.md](../abandoned/2026-09-09-vscode-dsh-integration.md)：umbrella。
- [docs/architecture.md](../../../docs/architecture.md) §2.2 / §3.1 / §3.2：frame 与 adaptor 的分层。
- [docs/concepts.md](../../../docs/concepts.md) 七：容器是具名子区域，不是 owner。
- [docs/vscode.md](../../../docs/vscode.md) §3：frame / part / container / pane / view。
- [docs/vscode.md](../../../docs/vscode.md) §4：扩展的 UI 能力范围。
- [2026-10-05-vscode-dsh-layout-boundary.md](../abandoned/2026-10-05-vscode-dsh-layout-boundary.md)：视图是单位、隔离与对等。
- [2026-10-06-vscode-view-catalogue.md](../abandoned/2026-10-06-vscode-view-catalogue.md)：视图目录与容器元数据。
- [2026-10-07-editor-host.md](../abandoned/2026-10-07-editor-host.md)：编辑器宿主。
- [2026-10-17-vscode-host-view-container-context.md](2026-10-17-vscode-host-view-container-context.md)：view container / view step。
- [2026-10-17-stack-view-chrome.md](../abandoned/2026-10-17-stack-view-chrome.md)：frame 侧的 stack chrome step。
