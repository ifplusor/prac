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
