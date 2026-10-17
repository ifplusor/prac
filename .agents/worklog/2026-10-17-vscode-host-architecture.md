# Worklog: vscode-host architecture

> 过程/证据。产物是 `.agents/notes/in-progress/2026-10-17-vscode-host-architecture.md`；本文件不签字、不进当前方向。

## 起点

- `docs/vscode.md` 已补齐 frame / part / container / pane / view 与 extension UI 能力范围。
- adaptor 侧已有 view catalogue、editor host 两个 step。
- container context note 是在 architecture 之前写的，先选了 B（headless `ViewPaneContainer`）。
- surface map note 是清单，不是 architecture。

## 复核时确认的事

- 扩展 UI 不是任意 DOM，而是一组封闭 surface：view container / view、menus、status bar、notifications / quick pick / dialog、webview / custom editor、编辑器内容 UI、专用视图、themes / settings / walkthrough。
- frame 只认 view / region；container 是具名子区域，不是 frame 的 owner。
- VS Code 的 `ViewPaneContainer` 是 adaptor 内部的语义，不是要在 frame 里补的层。
- container context note 把“collapse 怎么修”上升成“adaptor 的 container 机制”，并先选 B，属于 solution-first。
- surface map 的 owner 列过粗，且把 container context 当成现有 step，继承了同一个先验。
- 两张 note 都应在 architecture 之后重新进入，而不是先于 architecture。

## 处理

1. 新写 `2026-10-17-vscode-host-architecture.md`：
   - 职责边界；
   - 层与包；
   - 契约；
   - view / editor / overlay / extension host 生命周期；
   - surface ownership；
   - non-goals；
   - steps 与 open questions。
2. `2026-10-17-vscode-host-adaptor-surfaces.md` 标 `abandoned:superseded`，内容并入 architecture 的 surface ownership。
3. `2026-10-17-vscode-host-view-container-context.md` 标 `abandoned:superseded`；container/view 作为 architecture 之后的 step 重新推导。
4. frame 侧（stack chrome / grid）保持独立，不塞进 adaptor architecture。

## 验证

- `vp check --fix`；
- 检查 frontmatter 状态；
- 检查 architecture note 的链接；
- 检查 frame / umbrella 用词。
