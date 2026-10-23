# Worklog: UI framework implementation plan

> 过程/计划，不签字、不进当前方向。决策与设计见 `.agents/notes/in-progress/2026-10-20-ui-framework.md`；本文件只保存实现顺序、gate 与质量面检查表。

## Slice 0 — 两个来源、一个区域、两个 host

- DSH React view + VS Code tree view 进入同一目录，能放进 `primary sidebar` / `stage`；
- 标题 / 图标 / `available` 走状态通道；来源卸载只移除自己；
- frame 不出现来源分支；fake host 证明 frame 不调用 `layout(size)`。

**Gate**

- 标题变化不 remount；
- `when` 关 / 开原位恢复；
- 卸载隔离；
- DOM-only 移动不 `releaseView`。

## Slice 1 — container、跨来源组合与动作

- `viewsContainers` → `ContainerRecord` + 具名 view group（默认 stack）；container bar 在父层 select 上切 container；成员由 placement 派生；空 container / `hideIfEmpty`；
- **DSH view 放进 VS Code container**；**VS Code view 移出到别处**；来源消失时 container 有成员就不消失；
- `MenuId.ViewContainerTitle` 的动作走 owner 表；view / container / global 三种 owner；多个贡献者的 action 追加，不整表覆盖。

**Gate**

- container 增删不重建 frame；
- 空 container 按策略显示 / 隐藏；
- 用户移出 container 后 placement 赢；
- 跨来源放置不产生 host 分支；
- 来源卸载不带走别家 view；
- container 的 title actions / context keys 归当前 container，不跟随被移出的 view；view 自己的 title actions / welcome 跟随；
- 动作更新不 stale、同 id 冲突有诊断。

## Slice 2 — stage 与 editor

- stage = grid：行 / 列 / cell；每个 cell 是一个 region，内容根是 view group（默认 select）；文件编辑器、custom editor、webview panel 都是 group 里的 editor views；
- webview panel / custom editor / editor 作为 view（host kind `editor-pane`）；editor group 只在 VS Code adapter 内部做映射，不是 prac 类型；
- grid 的 resize / 加行列 / 移 cell 先做；跨区域移动：先证明 DOM-only 稳定 host，再单独处理 editor view / editor move；activation 走 placement，不走 resource；webview / iframe 例外显式化。

**Gate**

- grid track resize、加 / 删行列、移 cell 正确；
- cell = region，内容根是 select view group；
- 混合 select group：editor + DSH view 同组；select group total order 是可见顺序；frame 统一 group bar；editor 子集顺序同步到 `EditorGroupModel`；
- editor 的 dirty / preview / close / pinned 由 source 提供数据 / action，不画第二条 editor strip；
- 文件落在正确的组；
- 移动不丢 undo / 滚动 / 选区（按场景分别测）；
- activation 打开正确文件；
- 双 placement 不串台；
- iframe 不假装保留。

## Slice 3 — overlay / part / 质量面

- frame-hosted overlay：source-managed（`shell.overlay`）先做，frame-managed（`pracOverlay`）等真实需求再加；layer / order / entry host 归 frame；
- status bar / part items、a11y、i18n、theme、DnD、HMR 各自有 gate 或明确 out of scope。

## 质量面检查表

- **失败隔离**：adapter 失败、host 失败、view 失败分层；坏一个不坏 frame。
- **主题**：frame 在 boundary 上发布一组小 token；host 映射到 upstream（`--vscode-*` / DSH token）；active theme 归谁见 note 的待裁决。
- **i18n**：frame chrome 用 DSH locale；来源 label 是显示串，frame 不再翻译。
- **a11y**：frame chrome 的 container 条 / tab / sash 可键盘操作、有 role / aria；host 内的 view 拥有自己的 a11y。
- **DnD**：frame 管 view / container 的顺序与移动；host 管 view 内的 DnD；跨边界 DnD 需要 payload 契约，当前不做。
- **keybinding**：frame 全局 vs host-local；frame 不抢 host 内的按键（需要显式边界）。
- **HMR**：代码替换可能重置 host 状态；不承诺“代码替换不丢 view 状态”。

## 实施记录

### 2026-10-22 — resource layer（slice 1）

- 新增 `ui-layout/src/client/resource.ts`：category-specific definitions、registries、shared `ResourceStateStore`、materializer、phase、async、dependency retry、owner dispose、failure diagnostic。
- 新增 `resource.spec.ts`：category 隔离、duplicate、materialize、dependency、async、failure isolation、owner dispose、pending、binding factory。
- 验证：`pnpm --filter prac-client-ui-layout test` 158 passed；`check` / `build` 通过。
- 尚未接入 frame / vscode adaptor。

### 2026-10-22 — View / ViewGroup runtime（slice 2）

- 新增 `view.ts` / `viewGroup.ts`：view host mount/release/focus、group mode/order/active、binding 替换/dispose。
- 新增 `viewGroup.spec.ts`；resource 类型通过 `public.ts` 导出。
- 验证：`pnpm --filter prac-client-ui-layout test` 165 passed；`check` / `build` 通过。
- 尚未接入 placement / frame，也尚未实现跨 group 的 target-first move。

### 2026-10-22 — target-first move / materializer integration（slice 3）

- 新增 `move.ts`：目标先建、源后释放；失败保留源。
- `ViewGroup.get/has`；`View` / `ViewGroup` 作为 materializer 的实际 runtime。
- 新增 `runtimeResource.spec.ts`；公开 `MoveViewRequest` 类型。
- 验证：168 passed；`check` / `build` 通过。

### 2026-10-22 — VS Code concrete resources（slice 4）

- 新增 `vscode-host/src/client/resources.ts`：`VscodeViewGroupDefinition`、`VscodeViewDefinition`、`VscodeViewHost`、`VscodeGroupBinding`。
- container → stack，editor → select；`hostFactory` 保留 source-owned `hostKind` / `MoveIntent`。
- `bindingFactory` 改为接收完整 `ViewGroupResource`，以拿到 `metadata.id`。
- 新增 `resources.spec.ts`；`vscode-host` 增加 `test` script。
- 验证：ui-layout 168 passed；vscode-host 7 passed；两边 check/build 通过。

### 2026-10-22 — imperative view host path（slice 5）

- `prac-vscode-embed` 新增 `mountViewInto` / `releaseView`：frame 可直接挂载/释放 view，不必经过 React 组件；app 未 publish 时先记录元素。
- `PracVscodeFace` 新增 `mountView` / `releaseView`；映射 `vscode:view:<app view id>`。
- `createVscodeViewHost` 把 `VscodeView` + adapter 变成 `ViewHost`；source-owned `viewId`。
- 验证：embed check 通过；vscode-host 8 passed；两边 check/build 通过。

### 2026-10-22 — face adapter composition（slice 6）

- `VscodeGroupBinding` 增加 `actions()` / `runAction()`；`VscodeViewGroupSpec` 增加 `containerId`。
- 新增 `adapter.ts`：`createVscodeResourceDefinitions({ face, createGroup, createView })`，把 binding / host 接到 `PracVscodeFace`。
- 验证：vscode-host 10 passed；embed check 通过；vscode-host check/build 通过。

### 2026-10-22 — container context projection（slice 7）

- 新增 `context.ts`：`resolveContainerContext(view, binding)`，把 G 收敛为 group / unbound 两种有效 container context；source container 保留但不跟随。
- `VscodeViewSpec.containerId`、`VscodeGroupBinding.containerId`。
- 验证：vscode-host 13 passed；check/build 通过。

### 2026-10-22 — group placements / change events（slice 8）

- `ViewGroup.placements`：order + active + visible 的 frame 投影。
- `ViewGroup.onDidChange`：成员 / active / order / binding / dispose 变化通知。
- 验证：ui-layout 170 passed；check/build 通过。

### 2026-10-22 — frame placement bridge（slice 9）

- 新增 `frameBridge.ts`：`ViewGroupLayoutBridge` 把 `ViewGroup.placements` 投影到现有 layout store。
- 成员/顺序/active 跟随 group；离开 group 或 dispose 时移除。
- 验证：ui-layout 172 passed；check/build 通过（build 有既存 zustand unresolved 警告，不影响产物）。

### 2026-10-22 — ViewGroupHost frame registry（slice 10）

- 新增 `frameGroups.ts`：`ViewGroupHost` 管理 group id ↔ region 的一对一绑定与 bridge 生命周期。
- 重复 group / region、未知 region 拒绝；unregister 不 dispose group runtime。
- 验证：ui-layout 175 passed；check/build 通过。

### 2026-10-22 — assembly group host（slice 11）

- `createServices` 创建 `ViewGroupHost`；`PracLayoutFace` 新增 `registerViewGroup` / `unregisterViewGroup`。
- `index.ts` 在 frame effect 清理时 `viewGroups.dispose()`。
- 验证：ui-layout 175 passed；check/build 通过。

### 2026-10-22 — VscodeGroupHost + structural group runtime（slice 12）

- core 增加 `FrameViewGroup` 结构接口；`ViewGroupHost` / bridge / face 接受结构类型，不再要求具体 class。
- `VscodeGroupHost`：materialize group、attach binding、register 到 region、remove/dispose。
- `viewGroupsFromCatalogue` / `regionForLocation`。
- vscode-host 测试不再运行时 import core loader artifact。
- 验证：ui-layout 175 passed；vscode-host 17 passed；check/build 通过。

### 2026-10-22 — vscode group assembly（slice 13）

- `PracLayoutFace` 新增 `createViewGroup` / `createView`，由 core services 实例化 runtime。
- `vscode-host/index.ts` 创建 `VscodeGroupHost`；`syncGroups` 从 catalogue 派生 group resource、按 location 选 region、注册/移除。
- catalogue 变化时增量同步；plugin cleanup 清理 groups。
- 验证：ui-layout 175 passed；vscode-host 18 passed；check/build 通过。

### 2026-10-22 — catalogue views into groups（slice 14）

- 新增 `FrameView` 结构接口；`PracLayoutFace.createView` 返回 `FrameView`。
- `VscodeGroupHost.addView/removeView`：materialize `VscodeView`、加入 hosted group。
- `viewFromCatalogue`；assembly 从 catalogue 同步 container views，移除消失的 view。
- 验证：ui-layout 175 passed；vscode-host 19 passed；check/build 通过。

### 2026-10-22 — catalogue sync in VscodeGroupHost（slice 15）

- `VscodeGroupHost.sync(entries, regionIds)`：group + container views 的增量 reconcile。
- assembly 改为调用 `groupHost.sync`，去掉内联同步逻辑。
- 新增 sync 测试（添加/移除 group + view）。
- 验证：vscode-host 20 passed；check/build 通过。

### 2026-10-22 — editor group / file views（slice 16）

- `viewGroupsFromCatalogue` 在存在 file entry 时创建 `vscode:group:editor`（select）。
- `viewGroupIdFor` 统一 container / file → group id。
- `planViewGroups` 把 editor group 放到 `center`。
- `VscodeGroupHost.sync` 现在也 materialize file views。
- 验证：vscode-host 22 passed；check/build 通过。

### 2026-10-22 — placement authority validation（slice 17）

- 新增 frame bridge 测试：已有 placement 被 group 移动时只保留一个 view record，不产生第二份。
- 验证：ui-layout 176 passed；check 通过。

### 2026-10-22 — editor group follows active editor（slice 18）

- `VscodeGroupRuntime.select`；`VscodeGroupHost.select` 只在 view 属于该 group 时调用。
- `vscode-host` 订阅 `capabilities.editors`，把 app active file 投影为 editor group 的 active。
- 验证：vscode-host 22 passed；check/build 通过。

### 2026-10-22 — region-change recovery / dispose（slice 19）

- `VscodeGroupHost.regionOf`；sync 在 group region 变化时 unregister + re-add，而不是静默保留旧 region。
- 新增 group region change 与 dispose 测试（groups/views 清空、unregister 调用）。
- 验证：vscode-host 24 passed；check/build 通过。

### 2026-10-22 — workspace verification（slice 20）

- `pnpm test`：所有 package 通过（ui-layout 176、vscode-host 24、web-app 24 等）。
- `pnpm check`：0 errors；仅 3 个既存 warning。
- 修复新增 `PracLayoutFace` 方法导致的 arrangement test double 与 vscode-editor declaration-copy 类型问题。
- docs 格式化通过。

### 2026-10-22 — live container gate / region matching（slice 21）

- 起 3084 rig（新 token）后跑 live gate。
- 发现 `VscodeGroupHost` 把多个 container group 都注册到 `left`，触发 `region already hosts a view group`。
- 修正：container group 匹配已有的 `.../container:<containerId>` 子区域；未出现时等待 layout 变化再 sync；注册 transient 失败不破坏其它 group。
- 修正：`ViewGroupLayoutBridge` 不把用户已 hidden 的 view 重新显示。
- live gates 全绿：`verify:containers` 13/13、`verify:stack`、`verify:split`、`verify:persistence`、`verify:bottom` 均 exit 0。

### 2026-10-22 — live gates / editor group rollback（slice 22）

- 起 3084 rig，先跑 `verify:containers`：发现 container group 全部注册到 `left`，触发 region 冲突；改为匹配已有 `.../container:<id>` 子区域，transient 失败等下一次 sync。
- `verify:file` 发现单一 editor group 破坏 split editor 的第二 group；暂时回退 file → editor group 的自动 materialization，让既有 editor host 继续管理文件。
- `ViewGroupLayoutBridge` 不再把用户 hidden 的 view 重新显示。
- live：`verify:containers` 13/13、`verify:file` 全绿、`verify:stack` / `split` / `persistence` / `bottom` 全绿。

### 2026-10-22 — per-region editor groups / live validation（slice 23）

- `viewGroupsFromCatalogue` 按 file entry 的 `region` 建 `vscode:group:editor:<region>`，不再只有一个 editor group。
- `viewGroupIdFor` 将 file view 映射到其 region 的 editor group；`planViewGroups` 用 region 后缀定位。
- assembly 的 active-editor 同步改用 active.region 对应的 editor group。
- live：`verify:file` 全绿（含 split editor / 两 group / 两 surface），`verify:containers` 13/13 全绿。

### 2026-10-22 — views gate sash expectation（slice 24）

- `verify:views` 的 `spaceAndWidthComeBack` 失败来自陈旧常量：gate 假设 sash 占 5px flex 空间，但 frame 的 sash 是 absolute overlay、不占布局。
- 改为 `gutter = 0`；`verify:views` 全绿，`spaceAndWidthComeBack = true`。
- 根 `pnpm check` 0 errors。

### 2026-10-22 — editor group order + live file gate（slice 25）

- `VscodeGroupRuntime.reorder`；`VscodeGroupHost.reorder` 按 app editor 顺序投影到 group。
- assembly 在 editors 订阅中按 region 分组重排 file views。
- `verify:file` 全绿（含 split editor 两 group / 两 surface）。

### 2026-10-22 — dynamic view re-add（slice 26）

- 新增 `VscodeGroupHost.sync` 回归：view 从 catalogue 消失后再次出现，可以重新 materialize / add。
- 验证：vscode-host 24 passed；check/build 通过。

### 2026-10-22 — group recovery re-register（slice 27）

- 新增 `ViewGroupHost` 回归：group unregister 后，同 id 新 group 可以重新注册到同一 region。
- 验证：ui-layout 178 passed；check/build 通过。

### 2026-10-22 — grid data layer（slice 28）

- `GridNode` 进入 `LayoutNode`（rows/columns + row-major children），`gridNode()` helper。
- model：regionInfos / replace / isPresent / subtreeMin / resolveSizes / regionAncestry 处理 grid。
- frame：grid 作为 CSS grid 渲染，cell 可继续是 region/split。
- 新增 `grid.spec.ts`；ui-layout 182 passed，check/build 通过。
- 默认 stage 仍是 split tree，尚未接线。

### 2026-10-22 — stage grid wiring（slice 29）

- 默认 stage：`stage` 是 1×1 `GridNode`，内容仍是 `center` region；top split 的左右 sash 与 center tab strip 保持。
- `regionAncestry` 支持 grid parent；`removeRegion` 允许 grid 失去最后一个 cell。
- live：`verify:containers` 13/13、`verify:file`、`verify:split` 全绿。

### 2026-10-22 — stage grid attempt / revert（slice 30）

- 尝试默认 stage 用 1×1 grid wrapper；containers/file/split 仍绿，但 `verify:views` 截图裁剪失败（paintAt 越界）。
- 回退默认 stage 到原 split tree，保留 `GridNode` 数据层与 model/grid 测试。
- 复验：`verify:views` 全绿；ui-layout 183 passed。

### 2026-10-22 — stage grid live green（slice 31）

- 默认 stage 改为 1×1 `GridNode`；1×1 grid 渲染为 `display: contents`，不引入第二层盒模型。
- `regionAncestry` / `removeRegion` 支持 grid parent；grid 失去最后 cell 也保留空 grid。
- live 全绿：`verify:containers` 13/13、`verify:file`、`verify:views`、`verify:split`。

### 2026-10-22 — stage grid display:contents（slice 32）

- 默认 stage 为 1×1 `GridNode`；grid 在只有 1 个 cell 时渲染 `display: contents`，不改变父 split 几何。
- live 复验：`verify:views`、`verify:containers`、`verify:file` 全绿。
- 多 cell grid 的 split 语义留待后续，不在本轮强行改默认树。

### 2026-10-22 — grid placements / spans（slice 34）

- `GridPlacement`（row/column/rowSpan/columnSpan）进入 `GridNode.placements`；`gridNode` 校验越界。
- frame 按 placement 写 `gridRow/gridColumn`；`resolveSizes` 按 span 分配；单 cell/未放置保持透明。
- 新增 span、JSON 持久化、越界测试；live views/containers 全绿。

### 2026-10-22 — uncommitted review + dynamic group return（slice 35）

- 收口剩余 6 个未提交改动：paneHeader 声明、container action submenu、`runAction`、docs 边界；已提交 `399d0c8`。
- 新增 `VscodeGroupHost` 回归：container group 消失后重新出现，group + view 都能重建。
- vscode-host 25 passed；check/build 通过。

### 2026-10-22 — group label / bar data（slice 36）

- `ViewGroup` 增加可选 label；`ViewGroupState` 暴露 label。
- `ViewGroupHost.barItems(regionId)` 返回 groupId / label / active。
- frame container bar 优先使用 group label；`PracLayoutFace.createViewGroup` 接收 label；VS Code definition 传 `spec.title`。
- live：verify:containers 全绿；ui-layout 187 passed。

### 2026-10-22 — binding actions in group bar（slice 37）

- 新增 `GroupAction` / `GroupActionBinding`；`GroupBarItem` 带 `regionId` / `actions` / `runAction`。
- `ViewGroupHost.barItems` 从 group binding 投影 actions；frame container bar 优先渲染 binding actions，没有时回退 `prac.containerActions` slot。
- live：verify:containers 全绿；ui-layout 188 passed。

### 2026-10-22 — container action live gate（slice 38）

- `verify:containers` 新增 action bar 检查：至少一个 group/container action 按钮可点击，点击后 bar 仍在。
- live 全绿；无 prac-owned console error。

### 2026-10-22 — resize regression / stage grid default（slice 39）

- 发现默认 1×1/1×3 stage grid 会让 `resizeBoundary` 面对 grid child，横向 sash 拖拽 no-op；`verify:resize` 红。
- 回退默认 stage 到 split tree，保留 `GridNode` / placement / cell split 数据层。
- sash 拖拽改为 document capture 监听，避免 view host 吞 pointermove。
- live：`verify:resize` 恢复全绿。

### 2026-10-22 — grid stage + resize fallback（slice 40）

- 恢复默认 stage 为 1×1 GridNode。
- `readSplitDrawn` 对无 DOM box 的 grid child 使用 `resolveSizes` fallback；横向 sash 现在能 resize grid 边界。
- live 全绿：resize / containers / views / file。

### 2026-10-22 — multi-cell stage default（slice 41）

- 默认 stage 扩为 1×3 grid（1 row，最多 3 cells）。
- live 全绿：resize / containers / views / file / split。

### 2026-10-22 — frame reorder → group order（slice 42）

- `ViewGroupHost` 订阅 layout store；frame 端 reorder 后，若 group 成员都可见，写回 `group.reorder`。
- 新增 reorder 回写单测；live file/containers 全绿。

### 2026-10-22 — editor order 回写（slice 43，B）

- `EditorsActions` 增加 `reorder(placement, resource, index)`；workbench 用 `PracEditorGroup.moveEditor(editor, group, { index })`。
- `vscode-host` 订阅 frame 文件视图顺序，写回 editor model；`verify-tabs` 新增 `dragReordersTheEditorModel`。
- live：verify-tabs 全绿；ui-layout 189 / vscode-host 26 / check 0。

### 2026-10-23 — partial grid flow（slice 44，C part）

- 新增 `gridShape`：无显式 placement 时按 cell 数量流动，1 cell 全尺寸，2/3 cells 单带，4 cells 2×2。
- 默认 stage 仍是 1×3；2×2 默认在 split 上会破坏 left/down 几何，已回退。
- live：verify-split 全绿；grid 190 passed。

### 2026-10-23 — 2D stage placements（slice 45，C）

- 默认 stage 改为 2×2（1 cell 时仍 display: contents）。
- `splitRegionWith(..., {gridCells:true})` 现在按 source side 计算显式 placement，并扩展 rows/columns；不再靠 row-major 追加。
- 新增 side placement 单测；live 全绿：split/resize/containers/persistence/bottom/stack/views/file/tabs。

### 2026-10-23 — group action 单一来源（slice 46，D）

- 删除 `prac.containerActions` slot 与 `ui-vscode-views` 的 ContainerActions 注册；container bar actions 只从 `VscodeGroupBinding` 投影。
- frame 修正 group 查找（node/child 全路径）；action bar 标记 `data-prac-container-action-bar`。
- live：verify:containers 全绿；ui-layout 191 / check 0。

### 2026-10-23 — one-command UI acceptance（slice 47，A）

- 新增 `verify:ui`：临时 XDG/HOME rig + dynamic fixture，串行跑 containers/stack/split/resize/persistence/bottom/views/file/tabs/dynamic，失败也清理。
- 实际运行：10 个 gate 全绿，`UI ACCEPTANCE: all gates passed`。

### 2026-10-23 — true extension lifecycle（slice 48）

- 新增 phase-based `verify-extension-lifecycle`：`absent` 检查 catalogue/frame 清理，`restored` 检查重新安装后恢复。
- `verify:ui` 现在会停 rig、移除 fixture、重启 rig 验证 absent；恢复 fixture、再重启验证 restored。
- 实际运行：11 个阶段全绿，`UI ACCEPTANCE: all gates passed`。

### 2026-10-23 — host mount/release 断言（slice 49）

- frame 的 `IsolatedView` 带 `data-prac-view-id`，gate 能按 view id 断言 host。
- lifecycle restored 先点 Explorer 容器 + setFront，再断言 host > 0；absent 断言 host = 0。
- verify:ui 全绿（含 lifecycle restored mounted）。

### 2026-10-23 — grid cell move（slice 50）

- model 新增 `gridPlacements` / `moveGridCell` / `resizeGridCell`；move 交换 placement，resize 拒绝重叠。
- frame 多 cell grid 增加拖动 handle；drop 交换 cell。
- 新增 `verify:grid` 并纳入 verify:ui；12 个阶段全绿。

### 2026-10-23 — grid resize UI/API（slice 51）

- `PracLayoutFace` 增加 `moveGridCell` / `resizeGridCell`；services 接线。
- frame 每个多 cell 增加 resize handle（pointer drag 写 span）；grid gate 断言 handle 存在。

### 2026-10-23 — grid resize live gate（slice 52）

- 新增 `verify:grid-resize`：真实 pointer 拖动 resize handle，source cell 跨两行、target 收缩、span 持久化。
- 纳入 verify:ui；扩展激活噪声加入 harness 已知噪声，split gate 稳定。
- 全量：14 阶段全绿。

### 2026-10-23 — grid cell merge（slice 53）

- `mergeGridCells` 把相邻两 cell 合为一个 split cell，保留两边 region/view；拒绝非相邻/重叠。
- Shift-drag handle 走 merge，普通 drag 仍 swap；API 接线。
- 新增 `verify:grid-merge`；全量 verify:ui 15 阶段全绿。

### 2026-10-23 — grid cell unmerge（slice 54）

- `unmergeGridCell` 把 merged split cell 拆回 grid children，并分配 placement。
- frame 合并 cell 显示 `⧉` unmerge 按钮；API 接线。
- verify:grid-merge 增加 unmerge 断言；全量 verify:ui 15 阶段全绿。

### 2026-10-23 — catalogue → grid cell（slice 55）

- recall row 可 drag，写 `text/prac-view`；grid cell drop 解析 landing region 并 place view。
- 新增 `verify:grid-view` 并纳入 verify:ui；16 阶段全绿。

### 2026-10-23 — recall drag 收起（slice 56）

- recall row dragstart 将面板变为 0.2 透明并 pointer-events:none；dragend 恢复。
- verify:grid-view 断言 `data-prac-recall-dragging=true`；全量 verify:ui 16 阶段全绿。

### 2026-10-23 — unmerge span restore（slice 57）

- `GridNode.merged` 记录合并前 source/target placement；unmerge 恢复原始 span，不再均匀切分。
- 新增 unequal span 单测；live merge gate 与全量 verify:ui 16 阶段全绿。

### 2026-10-23 — nested merge placement fix（slice 58）

- merge 的 union placement 改 key 为 split id（不再 key target child）；nested merge 正确。
- 新增 nested merge/unmerge 单测；全量 verify:ui 16 阶段全绿。

### 2026-10-23 — UI acceptance docs

- 新增 `docs/ui-acceptance.md`：一条命令、gate 清单、动态 fixture 前提、profile 写入权限、known noise、加 gate 流程。
- UI framework note 的 Related 增加该文档。

### 2026-10-23 — tab → cell 直接拖（slice 59）

- grid cell drop 识别 tab 的 `text/plain`，直接 place；tab strip 内 reorder 不变。
- 新增 `verify:grid-tab`；全量 verify:ui 17 阶段全绿。
