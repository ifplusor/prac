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

选 **A**（已裁；B 已被用户收回）。理由：

1. 视觉/行为对齐 VS Code，但 chrome 实现归 prac；不把 VS Code 的 pane header 直接搬进行里；
2. `dsh:*` 与 `vscode:*` 共用同一行头，DSH 视图不需要另起一套；
3. 动作由视图的动作模型重新呈现，必要时用 DSH 的槽位/face 接；
4. 折叠/重排/sash 都在 prac 行头，`entry.collapsed` 一个权威。

B（保留 pane header）已被用户收回：它把 VS Code chrome 当成行头，违背“prac 重新实现”的原则。C 只作为分步落地时的中间状态。

## 上位原则（用户裁）

**视觉与行为对齐 VS Code；chrome 由 prac 重新实现，必要时用 DSH 的槽位/face 接动作；不无脑使用 VS Code chrome。**

- 一份 stack 行头由 prac 画：视觉/行为按 VS Code pane header（约 22px、图标、标题、twisty、动作、hover、键盘）。
- 内嵌 VS Code pane header **整体隐藏**，只留内容；不是保留它的标题区、再补 frame 控件。
- 动作由 `vscode-host`/`ui-vscode-views` 暴露的动作模型重新呈现（内联 + overflow）；不复制整套 VS Code menu，不依赖它的 DOM。
- 折叠/拖拽/sash 都归 prac 行头；`entry.collapsed` 权威；`dsh:*` 与 `vscode:*` 共用同一行头。
- 行高以 VS Code 的视觉 22px 为准；`dsh:*` 行头和混合栈向它对齐。
- 更外层：顶部 `sidebar / Explorer / Search / Source Control / conversation` container bar 不是 VS Code 的 activity bar + side bar，是后续独立决定。

## 实施顺序（A）

1. **label 修正（独立、无论选哪个都做）**：`prac.view` 注册携带 `VscodeCatalogueEntry.title`；layout 的视图目录暴露 label；`viewLabel` 用它，未知 id 才回退。消除 `WORKBENCH...` 原始 id。
2. **停止给 `vscode:*` 行画 prac 标题**：`entryHeader` 只给没有 pane header 的视图；pane header 保留；单视图 bare 不变。
3. **折叠同步**：pane header 的 collapse 与 `entry.collapsed` 二选一作为权威，另一边只读；行折叠高度与 pane header 高度对齐（`HEADER_HEIGHT` / CSS）。
4. **拖拽**：在 pane header 标题区加框架拖拽落点，避开动作按钮；重排仍走 `moveEntry`。
5. **门**：`verify:stack` 加“一行只有一个标题”“pane header 可见/动作可见”“折叠同步”“重排”；`verify:containers` / `outline` / `timeline` 回归；截图对比 Explorer。

## A 的目标形态

- `prac.view` 增加 `headless`（视图不自带 chrome）与 `actions`（视图的动作模型/face）描述；`ui-vscode-views`/`vscode-host` 隐藏自己的 pane header 并提供动作。
- prac 行头统一画：图标、标题、twisty、动作、hover、键盘；22px；`dsh:*` 与 `vscode:*` 一致。标题来自视图目录/title（不是 raw id）。
- 折叠/重排/sash 全部在 prac 行头；点击/键盘折叠，拖动超过阈值重排。
- 动作源 = `ViewPane.menuActions` / `MenuId.ViewTitle` 的**真实 Menu/IAction**；`view/title` 是扩展贡献面，不能只取 flat DTO。
- 动作桥优先级（考虑插件生态）：
  1. **短期**：frame 标题/twisty + pane 的 `.actions` 原地保留（pane 的 title/icon/twisty 隐藏）。扩展动作、子菜单、Toggle、ThemeIcon、`when` 全部原样，风险最低。
  2. **目标**：把 VS Code `ActionBar` 托管到 frame 的 action slot（pane header 隐藏，一个 header）。动作模型仍是真实 `IAction`，只是呈现位置移到 prac 行头。
  3. **prac 自绘 action bar** 只有在补齐 submenu/toggle/ThemeIcon/`when`/命令语义后才可用；否则会丢扩展贡献的动作。
- 动作模型必须保留：id/命令、label、icon（ThemeIcon/codicon）、enabled、checked、group、submenu/children、tooltip；`run` 走原 `IAction`；`onDidChange` 跟随 menu/context。

## Open questions



- ~~折叠权威取 pane 的 collapse 还是 stack 的 `entry.collapsed`？~~ 已落地：frame 的 `entry.collapsed` 是权威；pane header 的 twisty 隐藏、标题区不接指针，只放行动作。
- pane header 实际高度（约 22px）与 `HEADER_HEIGHT`(20) 仍差 2px；按上位原则以 pane header 高度为准，`dsh:*` 行头向它对齐；混合栈里的行高/基线还需要对齐一次。
- 顶部 container bar 与 VS Code activity bar + side bar 的差距：独立工作，不在 B 里做。
- 动作桥的边界：`ViewPane` 是否已创建/所在 container 是否 active；折叠行的 `showActions`（WhenExpanded）；toggle/submenu 动作；动作条宽度与 overflow；`dsh:*` 视图的动作 slot 空值。
- 插件生态：`view/title` 的 `when`/`enablement`、submenu、Toggle、ThemeIcon、扩展命令、动态菜单变更；需要一个测试扩展往 `view/title` 贡献动作，验证 live 出现并可执行。
- ~~拖拽落点跨影根时，标题区的命中如何避开右侧动作按钮？~~ 已落地：`entryOverlay` 在光 DOM 上，标题区到右侧 120px 为止；动作区由 `.actions` 接指针；行顶 `SASH_SIZE` 留给 sash。
- 混合栈里 `dsh:*` 的 prac 行头与 VS Code 的 pane header 如何视觉对齐（高度、padding、折叠 chevron）？
- 单视图 bare 与两视图 stack 之间的切换，pane header 的显隐是否会造成一次布局跳动？

## Related

- [stack 的行为定义](../resolved/2026-10-15-ui-layout-stack.md)：已签收的 A3（每条有标题条）在 B 下仍成立——标题条是视图自己的 pane header。
- [视图的隔离与对等](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：视图内部 chrome 与框架 chrome 的边界。
- `packages/client/ui-layout/DESIGN.md`：stack 行头、Sash、隔离。
