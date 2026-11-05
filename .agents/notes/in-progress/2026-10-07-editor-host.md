---
status: in-progress
---

# Agent Note: editor window host — window group 的 editor runtime 与 per-window pane host

> 上位模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。VS Code adaptor：[2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

> 当前实现：`EditorGroupModel` 仍是 editor input 的模型；每个 editor window 一个 `PracEditorPaneHost`（S1b，2026-10-30），host 自己持有 pane 生命周期（从 `EditorPanes` 收进来的代码），group 不再依赖 `EditorPanes`；active window 挂载、其余 detach。`WindowInput` 的 chat 投影已落地（S2a）；widget board window 还没做。board 是 window，widget 是 board 里的 view。

- **window group ↔ `IEditorGroupView`**：一个 window group 一个 editor group；editor group 是 adapter 内部 runtime，不是 prac UI 层。
- **window 是 frame 的权威对象**：frame 持有 window / order / active；adapter 为每个 window（editor / chat / widget）建一个 1:1 的 `EditorInput` 投影，做双向映射（window ↔ input）。
- `EditorGroupModel` 只持有这组投影（editor input）的顺序与 active；它是 frame window group 的投影，不是第二权威。
- `EditorWindow` 是 window 在 adapter 侧的表示（breadcrumbs + pane host），不是 VS Code editor-only；chat / widget window 也有 `EditorWindow` 表示。
- `PracEditorPaneHost` 是 per-window pane runtime；group 不再持有 `EditorPanes`（S1b 已落地）。
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
WindowGroup（frame；权威）
  └─ Window（id / appId / content）
       └─ EditorInput（adapter 投影；1:1，每个 window 一个）
            └─ EditorPaneHost / EditorPane
```

- **window group** 拥有 window 集合、tab strip、active window；
- **window** 是 frame 对象；内容是 editor / chat / diff / terminal / widget board；window 本身不依赖 VS Code；
- **`EditorInput` 投影**：adapter 为每个 window 建一个 `EditorInput`（editor window 用真实 input；chat / widget window 用自定义 input），window id ↔ input 1:1；关闭 / 激活 / 顺序都先改 frame，再投影；
- **editor group** 持有 `EditorGroupModel`，只持有这组投影；它是 window group 的投影，没有 UI chrome；
- **EditorWindow** 是 window 在 adapter 侧的表示：breadcrumbs（仅 editor content）+ `EditorPaneHost` + 内容；不是 VS Code editor-only；
- **EditorPaneHost** 是每个 window 的 pane runtime，不是 group 的 `EditorPanes`；
- widget window 的内容是 widget board，由 `ui-widget` 提供；它也走同一个 `EditorInput` 投影 / host。

### 1.1 投影表

| window content | `EditorInput` 投影 | pane |
|---|---|---|
| file / diff / custom editor / webview | 上游真实 input | `EditorPane` |
| chat / note | `ChatWindowInput`（自定义） | DSH view host |
| widget board / widget window | `BoardWindowInput`（自定义） | board host |

投影 id 与 window id 1:1；dirty / preview / save / move 能力按 content 决定——不能编辑的内容用只读能力，不参与 dirty / save。

## 2. 权威

- frame 是唯一写入方：window group、window、顺序、active window、tab strip；
- adapter 的 `EditorGroupModel` / `activeEditor` / `activeEditorPane` 是投影；上游的 open / close / activate 先翻译成 frame 操作，再由 frame 投影回落；
- **editor group 不进入 UI DOM**：没有 title、tabs、breadcrumbs、actions；只保留 active window 的 pane mount；
- 非 editor window 没有 breadcrumbs；pane 自己提供 breadcrumbs 时（例如自定义 pane），`EditorWindow` 不重复渲染，需要 `providesBreadcrumbs` capability；
- 不做 `focusin` 反向驱动 active；active 变化由 frame / 显式命令发起。

### 2.1 权威按事实分，不按层分

frame 是**组合状态**的权威；内容状态归来源。adaptor 是两者之间的投影 / host，不是第二个权威：

| 事实 | 权威 | 投影 / host |
|---|---|---|
| window 存在、order、active、placement | frame `WindowGroup` | `EditorGroupModel` 的 order / active |
| editor input、buffer、dirty、undo、view state | VS Code editor runtime | frame tab 的 dirty / active 只读派生 |
| webview 的 document / 内部状态 | webview runtime | pane 只持有 host element，不镜像内容 |
| chat / board 的内容与状态 | frame / DSH | adapter 只有 identity，不渲染 |
| 几何 / 布局 / tab strip / actions | frame | pane 只接受 layout |

由此推出三条规则：

1. **不要镜像内容状态**：buffer、dirty、webview DOM 不复制进 frame state；frame 只读派生 chrome（dot、title）。
2. **投影方向按事实定**：window order / active 是 frame → editor model；编辑器的 open / close / activate 是命令 → frame。不是一条全局单向流。
3. **内容 host 归来源**：editor 用 `EditorPane`，webview 用它的 element / iframe，chat / board 由 frame 自己渲染；adapter 不成为内容的第二所有者。

## 3. Pane

```text
EditorWindow
  ├─ breadcrumbs（除非 pane 自己提供）
  └─ EditorPaneHost
       └─ EditorPane
```

- `EditorWindowModel` 是数据：input、pane descriptor、view state、active；
- `EditorPaneHost` 是 runtime：descriptor 选择、pane 实例/容器、`setInput` / `clearInput`、layout、focus、dispose、trust / progress；
- inactive window：移除 pane DOM，保留 model / input / view state；
- 切 active window：旧 window 卸载 pane，新 window 挂载 pane；group 的 active editor 跟着 frame 的 active window；
- 具体 window content（text / diff / chat / board）决定 mount / unmount / focus / layout；
- chat / widget window 的投影 input 使用自定义 `EditorInput`，pane 由对应 content 提供；editor window 用上游 `EditorPane`。
- 上游 `EditorPanes` 是 group 级 active-pane manager：只有一个 `_activeEditorPane`，切换时 `clearInput`、`setVisible(false)`、移除 pane container；不活跃 input 不保留 pane DOM。把它映射到 window 模型时拆成数据（`EditorWindowModel`）和 runtime（per-window `EditorPaneHost`）。

### 3.1 拆分边界（方向）

不把 group 级 `EditorPanes` 当作 window 的 pane host：它的身份是「当前组的 active pane」，复用它会让 window 的身份跟着组 active 走，正是要拆掉的耦合。拆法：

| 职责 | 归谁 |
|---|---|
| pane descriptor / trust / error placeholder | `EditorPaneHost` |
| pane 实例与容器、`setInput` / `clearInput` | `EditorPaneHost` |
| visible / layout / boundary sashes / size constraints / focus | `EditorPaneHost` |
| pending `setInput` / 取消 / progress operation | `EditorPaneHost`（operation token 属于该 window） |
| active window 选择、mount slot、group focus restore | window group（`PracWindowGroup`） |
| group progress indicator / scoped context key / page position | window group |
| input / pane descriptor / view state / dirty / preview | `EditorWindowModel` |

约束：一个 window 一个 host；inactive window 不保留 pane DOM；window 关闭即 dispose host；group 关闭 dispose 全部 host；host 不读 group active。

## 4. Chrome

- window group tab strip 由 frame 画；tab 是 window；
- **actions 在 window group tab strip 右端**：adapter 把 active window 的 actions 解析成 resolved action model（editor window 用 `MenuId.EditorTitle`；chat / board 由各自 content 提供），frame 渲染并回调；group header 不再画 actions；
- **契约**：frame 暴露 keyed 的 window action model（per `viewId` 的 resolved actions + `onDidChange`）；adapter 在 active window 变化时推送；frame 渲染 primary + overflow，并回调 action id。view 自有的 React 动作随贡献注册（`PracContribution.actions`）进入 item facts，由 frame chrome 渲染；独立的动作座位已删除。
- **呈现**：primary 用 codicon icon（`action.icon` 的 class，document 的 codicon 样式已对 frame 生效），secondary 收进 `⋯` 菜单；没有 icon 的动作回退到文字 label。
- **overflow 不被裁剪**：菜单渲染到 `document.body`（`createPortal` + `position: fixed`），因为 tab strip 和 region 都 `overflow: hidden` / `contain: paint`。
- **每个 group 自己的 actions**：model 按 file placement 取该 group 的 actions，不只全局 active view；split 出来的新 group 立刻有自己的 tab strip actions。
- editor window 的 breadcrumbs 在 pane / window chrome 内；不属于 group tab strip；
- 非 editor window 没有 breadcrumbs；pane 自己提供时由 content 声明；
- overlay / toast / command palette 走 frame float layer。

## 5. 生命周期与身份

- group 生命周期跟 **window group**：window group 创建 / 关闭时创建 / 关闭；
- 空 group 对齐上游 `closeEmptyGroups`：非最后一个 window group 在最后一个 window 关闭后移除；最后一个 group 即使为空也保留（stage 的锚点），不自动关闭；设置关闭 `closeEmptyGroups` 时保留空 group；
- 「空」按 window 集合判断，不按 editor 集合判断：group 里还有 chat / widget window 时，最后一个 editor 关闭不删 group；`EditorGroupModel` 的 count 跟着投影，所以它看到的是 window 空；
- 移除空 group 时 region 随 group 移除；最后一个 region 不删；
- frame 的 window id / view id 是稳定身份；window ↔ `EditorInput` 1:1；关闭 window 关闭投影，关闭 input（上游）回到 frame 关闭 window；
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
- window 是 frame 权威；adapter 为每个 window（editor / chat / widget）建 1:1 `EditorInput` 投影；`EditorGroupModel` 是投影，不是第二权威。
- `EditorWindow` 是 window 在 adapter 侧的表示；editor content 有 breadcrumbs，chat / board content 没有；不套 `VscodeWindow` / `VscodeHost`。
- `EditorPanes` 不作为 group 级过渡复用；拆为 `EditorWindowModel` + per-window `EditorPaneHost`；group 只保留 active window 的 mount / progress / focus；pane active-only，inactive 卸载 DOM。
- frame 拥有 window order / active / tab strip；group 是投影；不做 focusin 反向驱动。
- breadcrumbs 属于 editor window；actions 在 window group tab strip 右端，frame 渲染 action model。
- actions 由 adapter 解析成 resolved model，frame 渲染；view 自有的 React 动作随贡献注册（`PracContribution.actions`），不复用 editor action model（座位已删除）。
- group 生命周期跟 window group，不跟 region；空 group 对齐上游：非最后一个空 group 移除，最后一个保留（见 §5）。
- window 外层隔离；混排保留 per-widget root。

## 8. Open questions

- `EditorPaneHost` 的职责切分与落地（§3.1 是方向）；关闭条件：spike 证明 pane 创建 / 切 active / dispose 不依赖 group 级 `EditorPanes`。
- action model 的 exact 字段与更新：command / toggle / submenu / dynamic `when`；overflow / keyboard / tooltip；
- 图标的跨 source 一致性：VS Code 的 codicon class 与 DSH 的 icon token 不是同一套；目前只有 VS Code action 有 icon。
- window action model 的字段 / overflow / 更新时机；关闭条件：跨 window kind 的渲染与回调验证。
- `EditorInput` 投影的 semantics：chat / widget input 的 dirty / save / preview / move / copy / `tabGroups` 能力怎么表达；关闭 input 如何回落到 window。
- extension `tabGroups` API 如何映射 / 隔离。
- 非 editor window（chat / note）的 `EditorPane` 如何实现 `setInput` / focus / scroll / breadcrumbs capability。
- application window 内是否允许 widget board slot（MVP 不允许）。
- 同源 window / board 合并 shadow root 的迁移条件。

## 9. Validation

1. **映射**：每个 window 有且只有一个 `EditorInput` 投影（chat / widget 也有）；frame 改顺序 / active 后投影跟上；上游激活 / 关闭 input 回到 frame，不出现双写。
2. **编辑器动作落在可见面上**：转到符号 / 定义 / 查找动的是 active editor window 的 pane。
3. **Outline / Timeline 跟随 active editor window**：切 window 后符号跟着换。
4. **DOM 里没有离屏 editor part**，同一文件的可见编辑面恰好一个。
5. **window 切换**：inactive window 的 pane DOM 被移除，active window 挂载自己的 pane；breadcrumbs 跟随 active editor。
6. **actions**：在 window group tab strip 右端，跟随 active window；group header 没有 editor actions；不与 breadcrumbs 抢行。
7. **生命周期**：非最后一个空 group 随最后一个 window 关闭而移除；最后一个 group 即使为空也保留（空 stage 仍可打开新 window）；关闭最后一个 editor 但仍有 chat 时不删除 group / region。
8. **隔离**：混排 window 的 `:host` / `.monaco-workbench` / overlay / focus 不互相穿透。
9. **门**：editor / file / views / outline / focus / tabs / close / layout / view，加上 window group / window / breadcrumbs / actions 的新断言。

## 10. Migration slices（spike 计划）

目标态（§1–§3.1）不是一次改出来的；按可独立验证的切片走，每一步保持现有门绿。

### S0（已落地）

- 空 group 的 window 守卫；actions 迁到 frame tab strip（codicon icon + 文字回退）。
- S1b：per-window `PracEditorPaneHost`，host 自持 pane 生命周期；group 只保留 active host 的 mount / layout / visibility / focus。

### S1 — editor window 的 per-window pane host

- 只替换 **editor window** 的 pane 管理：`EditorPaneHost` 吸收 `EditorPanes` 的 descriptor / trust / error placeholder、pane 实例与容器、`setInput` / `clearInput`、pending setInput / 取消 / progress、visible / layout / sashes / size constraints / focus、dispose。
- **S1b 实现**：`PracEditorPaneHost` 每 window 一个，host 内部直接持有 pane 生命周期（从上游 `EditorPanes` 收进来的代码：descriptor / trust / placeholder / pending setInput / progress / layout / close）；group 不再 import 或实例化 `EditorPanes`。
- group 只保留：active window 选择、mount slot、group progress / scoped context key / page position、focus restore。
- `EditorGroupModel` 仍是 editor input 的模型（S3 才降成投影）；`PracWindowGroup` 的 `IEditorGroupView` 方法委托给 active host。
- **验收**：`verify-file` / `verify-tabs` / `editor:group` / `editor:close` / `verify-close` 全绿；inactive window 无 pane DOM；同一文件的可见编辑面仍恰好一个。
- **退出条件**：`PracWindowGroup` 不再 import / 实例化 `EditorPanes`；`EditorPanes` 只作为上游类型参考存在。

### S2 — 非 editor window 的 mapping-only 投影

**约束**：frame 渲染所有 window 的内容；adaptor 只做映射，不负责渲染。

- `WindowInput` 是 **身份 / 元数据投影**（window id、title、active、order），不是内容；`PracWindowPane` 是**非渲染占位**（空 DOM、不抢 focus），让 VS Code 服务能看到一个 active editor pane。
- chat / board 的 DSH view / board element 仍由 frame 渲染；不搬进 pane，不复制内容。
- frame 仍是 order / active 的源；投影是派生的。非 editor window 的模型事件不得反写 frame（除非是显式命令），focus 不反向驱动 active。
- **S2a** chat（`dsh:main:conversation`）：**已落地**。`PracWindowInput` 是 readonly / singleton 的 identity input（resource `prac-window:/<id>`），`PracWindowPane` 是空 `EditorPane`（不画、不抢 focus）；`mapWindow` 以 `inactive` 打开它，frame 仍渲染 chat。face 未发布前的请求在 `vscode-embed` 排队，发布时 flush；`mappedWindows()` 只报告**真的进了 editor group** 的投影（`findEditors` 非空）；`ui-vscode-editor` 触发 chat 映射。
- **S2a.1** active / lifecycle：`mapWindow` 之外有 `activateWindow` / `unmapWindow` / `activeWindow`；face 未发布前的 active 请求也排队。chat 投影由 `ui-workbench` 的 arrangement 驱动（不再在 `ui-vscode-editor`）；frame active 是 conversation 时调 `activateWindow`，把 editor model 的 active 切到空投影；不反向 focus。`verify-file` 加 `chatActiveProjects` / `fileActiveProjects`。
- **S2b** widget board window：同形。每步用现有 tabs / close / group 门验证，并加“投影不产生第二份内容”的断言。
- **S2a.2** order：`orderWindow(id,index)` / `windowOrder()`；`vscode-host` 的 `syncFrameEditorOrder` 把 frame 同一 region 的 file view 与 mapped window 一起排序，file 走 `actions.reorder`，window 走 `orderWindow`。order 投影**不 pin preview**：`PracWindowGroup.moveEditorInsideGroup` 只在非 preview 时 pin；否则 close/reopen conversation 后的 Explorer 单击会把临时 editor 变成永久 tab。门：`previewSurvivesCloseReopen`。
- **S2a.3** region：`mapWindow(id,title,region?)` / `windowOrder(region?)`；window 打开到 frame region 对应的 group（`groupForRegion`），`orderWindow` 用 input 所在 group，不假设 active。`ui-vscode-editor` 跟踪 conversation 的 region，移动时重新投影。门：`chatMovesRegion`（conversation 移到 right 后，`windowOrder("right")` 第一项是它）。
- **S2a.4** lifecycle：frame view hidden / 不存在时 `unmapWindow` 移除投影；重新 show 时重新 `mapWindow`。门：`hiddenWindowUnmaps` / `shownWindowRemaps`。frame 的 tab close 对 conversation 置 `closable`，请求到来时 `layout.hide`，sync 再 unmap；门：`closingChatUnmapsProjection`。chat 的 title 仍是静态 "Chat"。
- **Breadcrumbs 回归**：per-window host 是 `position:absolute; inset:0`，但 `editorContainer` 是 `position:static`，host 相对 group 定位，覆盖了 breadcrumbs 行。`editorContainer` 改为 `position:relative; overflow:hidden`，host 锚在 editor 框内；门：`breadcrumbsRender` / `breadcrumbsSitAboveEditor`。
- 这个形态**不限于 chat / board**：editor 是 `content = source`（VS Code 的 input / buffer / pane）；webview 是 `content = source`（webview document + host element）；chat / board 是 `content = frame`（adapter 只有 identity）。三者共用同一个 window projection，区别只在 content 归谁、有没有 host element。
- **借鉴 `WebviewEditor` 的 pane host 形态，不用 webview 运行时**：`webviewEditor.ts` 的 `EditorPane` 只持有 element、处理 create / layout / setVisible / focus / clearInput / dispose，内容由外部提供。`PracWindowPane` 同样只做 host；chat / board 的 React 内容由 frame 用 portal 投到这个 element，仍是 frame 渲染。实际 webview/iframe 会另起 document，复制内容和状态，不是 mapping-only。
- 风险：两个 active 源（frame / editor model）；空 pane 若抢焦点或参与 layout 就会露馅。必须保持 pane 无内容、无 breadcrumbs、无 actions。
### S3 — `EditorGroupModel` 降为只读投影

**当前状态（2026-10-31）**：chat 投影在 `ui-workbench`；`PracWindowProjection` 是 frame-owned window 的唯一写入口；file/window order 都走它。`PracWindowGroup` 有按 `GroupModelChangeKind` 的 model write 审计，`EmbeddedWorkbench.editorModelWriteAudit()` 聚合，并区分 projection / external。门：`frameFrontDoesNotWriteModel`、`dragWritesModelOnce`、`appActivateWritesActiveOnly`、`projectionIsQuiet`。**model 仍是 writer，字面只读投影未做**；这是已知边界，不是已完成项。

- 去掉“模型也能改顺序 / active”的路径：所有写操作先落到 frame `WindowGroup`，投影只读；加一条单写者断言（改模型不产生第二次 frame 变更）。
- `IEditorGroupView` 的 model getter / 事件由投影提供；upstream 的 `moveEditor` / `copyEditor` 作为 adapter 内部实现，最终落到 frame 的 window move。
- **验收**：tab 拖拽、app `activate`、close、split 后没有双写；`verify-tabs` 的 storm 检查仍稳。

### S4 — 收尾

**P0 首步（2026-10-31）**：frame 的 `ViewRecord` / `ViewInfo` 增加 `FrameViewKind = "window" | "widget"` 判别；catalogue 的 file entry 标 `window`，`source === "view"` 标 `widget`；board window 还没有分类。门：`fileViewIsWindow` / `sidebarViewIsWidget`。这是 window/widget 拆模型的第一刀，不是完整拆分。

- 删除 group 级 `EditorPanes` 的残留依赖、旧的 `PracEditorHost` 路径与不再使用的类型；docs / worklog 同步。
- 性能：per-window host 的 pane 实例保留策略（保留实例 / 只保留 model）在 S1 实测后定。

### Spike 要回答的问题

1. `EditorPaneHost` 的 pane 实例在 inactive 时是保留（detach）还是 dispose（重建）：状态 / 内存 / 首帧三者取哪两个。
2. trust / error placeholder 的 `groupView.openEditor` 回调在 per-window host 里落到哪个 window。
3. `EditorGroupModel` 的 preview / pinned / sticky / move 语义在投影里保留多少，哪些直接由 frame 的 window 模型表达。
4. chat / board 的 `EditorInput` 能力：dirty / save / preview / move / `tabGroups` 如何表达；不能编辑的内容用只读能力，不参与 dirty / save。
5. 焦点：host 的 focus 事件如何避免再次触发“焦点被读成 active”的环（2026-10-08 那条）。
