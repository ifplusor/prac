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
