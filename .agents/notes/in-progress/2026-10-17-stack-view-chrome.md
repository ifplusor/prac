---
status: in-progress
---

# Agent Note: stack 视图的标题归属

## Problem

Stack 的一行出现**两条标题**：

- prac 的 stack 行头：`WORKBENCH.EXPLORER.FILEVIEW`、`WORKBENCH.EXPLORER.OPENEDITORSVIEW` 这类**原始 id**；
- 视图内部的 VS Code pane header：`PRAC-DEV`、`OPEN EDITORS`、`PROBE WEBVIEW`——这才是视图标题，也是文件树的 root。

容器栏的 `Explorer` 是容器选择，不是重复；`PRAC-DEV` 是 VS Code 的 pane header，也不是多余。**多余的是 prac 给一个已经自带 pane header 的视图又加了一条行头**。同时，行头 label 取的是 id 而不是视图标题，是独立可见的 bug。

## 边界

- “视图标题归谁”是**视图 chrome 的归属**，不是布局几何；sash、折叠手柄、拖拽落点是布局 chrome。
- 视图内部自带的 chrome（VS Code pane header、动作菜单）属于视图；框架不应为了统一而复制一套，也不应无声丢掉动作。
- 容器栏、sash、折叠/拖拽是框架 chrome，保留。

## Options

### A. prac 行头唯一

在 stack 中隐藏 VS Code pane header；prac 行头显示视图标题，并把 pane header 的动作收进一个紧凑的 `...` 菜单。

- 优点：所有行一个样式；行高固定 20；不跨隔离边界；DSH/VS Code 一致。
- 代价：动作菜单要另做一套（`MenuId.ViewTitle`、浮层锚点、可发现性）；等于把视图自己的标题/动作搬到框架，重复了视图 chrome。

### B. VS Code pane header 唯一（推荐）

`vscode:*` 视图在 stack 中**不画 prac 标题**，保留它自己的 pane header 作为行头；prac 只加：

- stack 折叠手柄（与 `setEntryFolded` 同步，或用一个不覆盖 pane header 的框架 overlay）；
- 标题区的拖拽重排（避开 pane header 右侧动作）；
- 行边界的 sash。

`dsh:*` 这类没有 pane header 的视图继续用 prac 行头；单视图 bare 时保留 pane header。

- 优点：一视图一标题；动作原地保留；与 VS Code 的 view pane 同形；符合“视图内部是视图自己的”。
- 代价：折叠状态要在 pane 的 collapse 与 stack 的 `entry.collapsed` 之间桥接；拖拽要跨影根定位标题区；混合栈里 VS Code 行头与 DSH 行头的高度/样式要对齐。

### C. 过渡：先隐藏一条标题

先保留 pane header 和动作，把 `vscode:*` 行的 prac 标题隐藏（只留折叠/拖拽条）；或反过来只隐藏 pane header 的标题文字。

- 优点：最快消除重复标题，动作不丢。
- 代价：仍是两条横条/两个折叠 chevron；只是暂时不重复文字；不是终态。

## Decision

选 **B**（已裁）。理由：

1. 一视图一标题，且标题来自视图自己，不需要框架复制视图标题/动作；
2. 动作原地保留，不额外造一套菜单；
3. 与 VS Code 的 pane/stack 关系一致；
4. 框架 chrome 收敛到 sash、折叠、拖拽落点，符合 layout boundary 的“框架 chrome 是装饰”的边界。

A 作为“统一外观”的备选，但代价是把视图内部 chrome 框架化；C 只作为分步落地时的中间状态。

## 实施顺序（B）

1. **label 修正（独立、无论选哪个都做）**：`prac.view` 注册携带 `VscodeCatalogueEntry.title`；layout 的视图目录暴露 label；`viewLabel` 用它，未知 id 才回退。消除 `WORKBENCH...` 原始 id。
2. **停止给 `vscode:*` 行画 prac 标题**：`entryHeader` 只给没有 pane header 的视图；pane header 保留；单视图 bare 不变。
3. **折叠同步**：pane header 的 collapse 与 `entry.collapsed` 二选一作为权威，另一边只读；行折叠高度与 pane header 高度对齐（`HEADER_HEIGHT` / CSS）。
4. **拖拽**：在 pane header 标题区加框架拖拽落点，避开动作按钮；重排仍走 `moveEntry`。
5. **门**：`verify:stack` 加“一行只有一个标题”“pane header 可见/动作可见”“折叠同步”“重排”；`verify:containers` / `outline` / `timeline` 回归；截图对比 Explorer。

## 实现（B，已落地）

- **label**：`ui-vscode-views` 把 `VscodeCatalogueEntry.title` 作为 `prac.view` 的 `label` 注册；layout 的 `readDeclaredViewIds` 记录 `declaredViewLabel`，`viewLabel` 优先用它。Explorer 的栈行现在显示 `Outline` / `Timeline` / `Open Editors` / `prac-dev` / `Probe Webview`，不再出现 `WORKBENCH...` 原始 id。
- **expanded `vscode:*` 行**：不画 `entryHeader`；VS Code pane header 保留为唯一标题；`entryOverlay` 只提供折叠按钮和标题拖拽，位于 pane header 之上、从 `SASH_SIZE` 开始（行顶的 sash 不被盖住），右侧留 120px 给 pane header 动作。
- **pane header 的重复折叠**：`IsolatedView` 在 frame-chrome 行上带 `data-prac-view-chrome="frame"`；隔离内的 CSS 隐藏 `.twisty-container`，并让 `.pane-header` 本身 `pointer-events: none`、只放行 `.actions`。折叠权威是 stack 的 `entry.collapsed`；pane header 自己的 collapse 不再抢事件。
- **folded `vscode:*` 行**：没有 pane header，继续用 frame 的 `entryHeader`（title 来自 label，折叠/拖拽都在）；行高 20。
- **`dsh:*` 行**：不变，frame 行头。**单视图 bare**：没有 stack 行头，保留 pane header。
- **证据**：Explorer live 截图（一行一标题、twisty 隐藏、pane header 动作仍在）；ui-layout **147** 单测；六门 live 全绿（`verify:stack` 17/17、`resize`、`split`、`containers`、`persistence`、`bottom`）。

## Open questions



- ~~折叠权威取 pane 的 collapse 还是 stack 的 `entry.collapsed`？~~ 已落地：frame 的 `entry.collapsed` 是权威；pane header 的 twisty 隐藏、标题区不接指针，只放行动作。
- pane header 实际高度（约 22px）与 `HEADER_HEIGHT`(20) 仍差 2px；折叠行 20、展开行由 pane header 撑起，混合栈里的行高/基线还需要对齐一次。
- ~~拖拽落点跨影根时，标题区的命中如何避开右侧动作按钮？~~ 已落地：`entryOverlay` 在光 DOM 上，标题区到右侧 120px 为止；动作区由 `.actions` 接指针；行顶 `SASH_SIZE` 留给 sash。
- 混合栈里 `dsh:*` 的 prac 行头与 VS Code 的 pane header 如何视觉对齐（高度、padding、折叠 chevron）？
- 单视图 bare 与两视图 stack 之间的切换，pane header 的显隐是否会造成一次布局跳动？

## Related

- [stack 的行为定义](../resolved/2026-10-15-ui-layout-stack.md)：已签收的 A3（每条有标题条）在 B 下仍成立——标题条是视图自己的 pane header。
- [视图的隔离与对等](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：视图内部 chrome 与框架 chrome 的边界。
- `packages/client/ui-layout/DESIGN.md`：stack 行头、Sash、隔离。
