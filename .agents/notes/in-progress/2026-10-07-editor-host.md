---
status: in-progress
---

# Agent Note: editor window host — window group 的 editor runtime 与 per-window pane host

> 上位模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。VS Code adaptor：[2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

- **window group ↔ `IEditorGroupView`**：一个 window group 一个 editor group；editor group 是 adapter 内部 runtime，不是 prac UI 层。
- **window ↔ editor input**：application window（editor / chat / diff / terminal）与 widget window 都是 editor input；`EditorWindow` 是 VS Code editor application window 的 prac 实现。
- `EditorGroupModel` 持有该组 windows（editor input）的顺序与 active；frame 拥有 window group / window order / active，group 是投影。
- `EditorPanes` 是 group 级 active-pane manager；按 window 模型拆成 `EditorWindowModel`（数据）+ per-window `EditorPaneHost`（runtime）。
- pane active-only：inactive window 卸载 pane DOM，保留 input / model / view state；由具体 window content 控制挂载 / 卸载。
- breadcrumbs 属于 editor window / pane；actions 在 window group tab strip 右端，由 frame 渲染 adapter 提供的 action model。

## Problem

当前实现把 editor group 放在 region 上，并让 group 拥有 title / tabs / breadcrumbs / actions：

- frame 有 active window，editor group 有 active editor，混合 window group（chat + editor）时两套状态分离；
- group tab strip 与 window group tab strip 重复；
- group 生命周期绑 region：空 group 删除 region、group rehome、region prune 都是下游补丁；
- 上游 editor CSS 以 `.part.editor > .content > .editor-group-container` 为祖先，prac group 直接挂 `.monaco-workbench`，规则不匹配。

`IEditorGroupView` 不能去掉：`EditorPanes` 需要真实 group，`EditorInput` / `EditorPane` 贡献（breadcrumbs、peek、diff、text actions）依赖它。问题不是“要不要 group”，而是 **group 放在哪一层、它能拥有什么**。

## 1. 对象

```text
WindowGroup（prac / frame）
  ↔ IEditorGroupView（adapter runtime）

EditorWindow（prac window；VS Code editor application window 实现）
  ├─ breadcrumbs（可选）
  └─ EditorPaneHost / EditorPane
```

- **window group** 拥有 window 集合、tab strip、active window；
- **editor group** 持有 `EditorGroupModel`，是 window 集合在 editor runtime 里的投影；没有 UI chrome；
- **EditorWindow** 本身就是 VS Code editor application window 的 prac 实现，负责 breadcrumbs、pane、内部 workbench context；不套 `VscodeWindow` / `VscodeHost`；
- **EditorPaneHost** 是 EditorWindow 内部的 pane runtime，不是 group 的 `EditorPanes`；
- widget window 的内容是 widget board，由 `ui-widget` 提供；它同样以 EditorWindow / editor input 形态进入 window group。

## 2. 权威

- frame 拥有 window group、window、顺序、active window、tab strip；
- adapter 的 `activeEditor` / `activeEditorPane` 是 active window 的投影，不是第二权威；
- **editor group 不进入 UI DOM**：没有 title、tabs、breadcrumbs、actions；只保留 `EditorPanes` 需要的最小 pane 容器；
- 非 editor window 没有 breadcrumbs；pane 自己提供 breadcrumbs 时（例如自定义 pane），`EditorWindow` 不重复渲染，需要 `providesBreadcrumbs` capability；
- 不做 `focusin` 反向驱动 active；active 变化由 frame / 显式命令发起。

## 3. Pane

```text
EditorWindow
  ├─ breadcrumbs（除非 pane 自己提供）
  └─ EditorPaneHost
       └─ EditorPane
```

- `EditorWindowModel` 是数据：input、pane descriptor、view state、active；
- `EditorPaneHost` 是 runtime：descriptor 选择、pane 实例/容器、`setInput` / `clearInput`、layout、focus、dispose、trust / progress；
- inactive editor window：移除 pane DOM，保留 model / input / view state；
- 切 active window：旧 window 卸载 pane，新 window 挂载 pane；group 的 active editor 跟着 frame 的 active window；
- 具体 window content（text / diff / chat）决定 mount / unmount / focus / layout；
- 上游 `EditorPanes` 是 group 级 active-pane manager：只有一个 `_activeEditorPane`，切换时 `clearInput`、`setVisible(false)`、移除 pane container；不活跃 input 不保留 pane DOM。把它映射到 window 模型时拆成数据（`EditorWindowModel`）和 runtime（per-window `EditorPaneHost`）。

## 4. Chrome

- window group tab strip 由 frame 画；tab 是 window；
- **actions 在 window group tab strip 右端**；adapter 把 active editor input 的 `MenuId.EditorTitle` 解析成 resolved action model（command / toggle / submenu / enabled / group / order / icon / tooltip / overflow），frame 渲染并回调；
- editor window 的 breadcrumbs 在 pane / window chrome 内；不属于 group tab strip；
- 非 editor window 没有 breadcrumbs；
- overlay / toast / command palette 走 frame float layer。

## 5. 生命周期与身份

- group 生命周期跟 **window group**：window group 创建 / 关闭时创建 / 关闭；
- 最后一个 editor window 关闭不等于 group 关闭；空 group 合法；
- 不再由空 group 触发 `removeRegion`，不再有 region prune / group rehome；
- frame 的 window id / view id 是稳定身份；
- 打开文件 = 在目标 window group 创建 / 聚焦 editor window；
- split = frame 的 window group split；move = window 在 window group 之间移动；
- 上游 `moveEditor` 只作为 adapter 内部实现细节，不是 prac 的窗口操作。

## 6. 隔离

- window 是外层 containment / stacking / theme / focus 边界；
- 混排 VS Code + DSH 的 window 保留 per-widget root / source-scoped 子树；window root 只做外层 containment；
- `EditorPane` 内部的 webview / iframe 自己的 browsing context；
- 交叉 window 的 overlay 走 frame float layer。

## 7. Decisions

- window group ↔ editor group；editor group 是 adapter runtime，不是 prac UI。
- 所有 stage window 都是 editor input / EditorWindow；application window 与 widget window 只是内容不同。
- EditorWindow 是 VS Code editor application window 的 prac 实现，不套 `VscodeWindow` / `VscodeHost`。
- `EditorPanes` 拆为 `EditorWindowModel` + per-window `EditorPaneHost`；pane active-only，inactive 卸载 DOM。
- frame 拥有 window order / active / tab strip；group 是投影；不做 focusin 反向驱动。
- breadcrumbs 属于 editor window；actions 在 window group tab strip 右端，frame 渲染 action model。
- group 生命周期跟 window group，不跟 region；空 group 合法。
- window 外层隔离；混排保留 per-widget root。

## 8. Open questions

- `EditorPaneHost` 从 `EditorPanes` 抽取 / 改写，还是先复用 group 级 `EditorPanes` 过渡。
- action model 的 exact 字段与更新：command / toggle / submenu / dynamic `when`；overflow / keyboard / tooltip。
- extension `tabGroups` API 如何映射 / 隔离。
- 非 editor window（chat / note）的 `EditorPane` 如何实现 `setInput` / focus / scroll / breadcrumbs capability。
- application window 内是否允许 widget board slot（MVP 不允许）。
- 同源 window / board 合并 shadow root 的迁移条件。

## 9. Validation

1. **编辑器动作落在可见面上**：转到符号 / 定义 / 查找动的是 active editor window 的 pane。
2. **Outline / Timeline 跟随 active editor window**：切 window 后符号跟着换。
3. **DOM 里没有离屏 editor part**，同一文件的可见编辑面恰好一个。
4. **window 切换**：inactive window 的 pane DOM 被移除，active window 挂载自己的 pane；breadcrumbs 跟随 active editor。
5. **actions**：在 window group tab strip 右端，跟随 active editor；不与 breadcrumbs 抢行。
6. **生命周期**：window group 关闭才关闭 group；关闭最后一个 editor 不删除 window group / region。
7. **隔离**：混排 window 的 `:host` / `.monaco-workbench` / overlay / focus 不互相穿透。
8. **门**：editor / file / views / outline / focus / tabs / close / layout / view，加上 window group / window / breadcrumbs / actions 的新断言。
