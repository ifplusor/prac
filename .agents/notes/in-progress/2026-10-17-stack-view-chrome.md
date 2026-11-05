---
status: in-progress
---

# Agent Note: stack / widget header 的标题归属

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。frame / chrome：[2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

- stack / widget board 的行头由 **prac** 画：title / icon / twisty / fold / drag / sash / action slot；
- VS Code 的 pane header 不再作为行头：`vscode:*` widget 的 `.title` / `.icon` / `.twisty` 隐藏，只保留 `.actions` 的动作；
- `dsh:*` widget 使用同一个 prac 行头；
- 折叠权威是 frame 的 `entry.collapsed`；
- 行高以 VS Code 的 22px 视觉为准；
- 动作随 widget 的贡献注册（`PracContribution.actions`）进入 item facts；VS Code 的 `.actions` 留在自己的 pane；frame 不做统一 action bar。

## Problem

Stack 的一行出现两条标题：

- prac 行头显示 raw id（`WORKBENCH.EXPLORER.FILEVIEW`）；
- VS Code pane header 显示真正的标题（`PRAC-DEV`、`OPEN EDITORS`）。

同时，折叠 / 拖拽 / sash 归 frame，但 pane header 自己也有 twisty / actions，形成两套 chrome。

## 1. 归属

| chrome | 归谁 |
|---|---|
| stack / widget 行头、title、icon、twisty、fold、drag、sash | **prac / `ui-widget` board** |
| widget 内部内容区 | widget / source |
| VS Code pane header 的 title / icon / twisty | **隐藏** |
| VS Code `.actions`（`view/title` 扩展动作） | 保留在 action slot |
| DSH 贡献注册的 actions | 由 frame chrome 渲染（不再有独立座位） |
| 单 widget bare 时的 pane header | 按 bare 规则保留 |

## 2. 决策

采用 **prac 行头唯一**：

- 视觉 / 行为对齐 VS Code pane header，但 chrome 实现归 prac；
- 内嵌 VS Code pane header 整体隐藏，不只隐藏标题文字；
- `dsh:*` 与 `vscode:*` 共用同一行头；
- 折叠 / 重排 / sash 全部在 prac 行头；
- `entry.collapsed` 是折叠权威；
- 行高 22px；`STACK_HEADER_HEIGHT = 22`；
- 动作槽由 widget 自持，frame 只提供 slot 位置；
- 标题优先取视图自己的 pane 标题；catalogue title 只是回退；
- 顶部 container bar 不是 VS Code activity bar + side bar，是另一件工作。

## 3. 实现状态

- label 修正：`prac.view` 注册携带 `VscodeCatalogueEntry.title`；layout 的视图目录暴露 label；未知 id 才回退 raw id；
- `vscode:*` 行头：frame 画 title / twisty / fold / drag；pane `.title` / `.icon` / `.twisty` 隐藏，`.actions` 保留；
- 折叠：frame 的 `entry.collapsed` 权威；pane twisty 隐藏；
- 拖拽：pane header 标题区加 frame 拖拽落点，避开右侧 actions；重排走 `moveEntry`；
- 动作：VS Code `.actions` 与 DSH 贡献注册的 actions 各自渲染；frame 不统一 action bar；
- 22px 行高与 container label / group-binding actions 已落地；
- 视觉边界：动作条可以完全不同源；frame 的 title / twisty / icon 不承诺与 VS Code 像素级一致。

## 4. 待接

- view icon：frame 的 shadow 里没有 codicon font-face；需要 view-owned icon descriptor（自包含 SVG 或 icon style/font），暂不做；
- mixed stack 的 DSH / VS Code 行头基线、padding、chevron 对齐；
- 折叠行的 `showActions`（WhenExpanded）；
- 动作 slot 宽度 / overflow；toggle / submenu；
- 插件生态测试：VS Code `view/title` 与 DSH 贡献注册的 actions 各一条 live 贡献；
- 单 widget bare ↔ stack 切换时 pane header 显隐是否造成布局跳动。

## 5. Decisions

- prac 行头唯一；VS Code pane header 整体隐藏。
- 标题来自视图自己的标题；catalogue title 回退。
- `entry.collapsed` 权威；折叠 / 拖拽 / sash 归 frame。
- 动作槽 widget 自持；frame 不统一 action bar。
- 行高 22px；`vscode:*` 与 `dsh:*` 共用行头。
- 顶部 container bar 另做，不混入本 note。

## 6. Open questions

- mixed stack 行头的最终视觉对齐。
- view icon 的跨 shadow 传递。
- 动作 slot 的统一适配器是否在后续引入。
- bare / stack 切换的 pane header 显隐策略。

## 7. Validation

- 一行只有一个标题；没有 raw id。
- pane header 的 `.actions` 可见、可执行；DSH 动作可见、可执行。
- 折叠 / 展开与 `entry.collapsed` 同步；拖拽重排只改 placement。
- 22px 行高与 container label 对齐。
- `verify:stack` / `containers` / `persistence` / `resize` / `split` / `bottom` 回归。
- 混排 stack 的 CSS / focus / overlay 不互相穿透。

## 8. Related

- [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)：frame chrome / stack 几何。
- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：widget board / actions。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：隔离。
