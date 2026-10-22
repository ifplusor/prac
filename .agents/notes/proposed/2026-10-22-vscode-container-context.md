---
status: proposed
---

# Agent Note: vscode-host 的 container context — ViewPaneContainer、view group 与 editor group 的接缝

> **这是哪件工作**：vscode-host adaptor 的 container context step。它决定 adaptor 如何承接 VS Code 的 container 语义，同时不把 container 变成 prac 的成员权威。
> **关系**：adaptor 骨架见 [2026-10-17-vscode-host-architecture.md](../in-progress/2026-10-17-vscode-host-architecture.md)；UI umbrella 见 [2026-10-20-ui-framework.md](../in-progress/2026-10-20-ui-framework.md)。

## Summary

prac 的 container 是**具名 view group，默认 stack**；成员由 placement 派生。VS Code 的 `ViewContainer` / `ViewPaneContainer` / `ViewPane` 是 adaptor 内部的表示，不是 prac 的第二套 container 模型。

这个 step 要定的是：adaptor 用哪种 **container context** 承接 VS Code 的 container 行为——view 集合、可见性、顺序、collapse、title / menu、focus、drag / drop——并让 DSH view 和 VS Code view 能同时出现在一个 container 里。

container context 属于 **`ContainerBinding`**；`ContainerBinding` 只挂到 `source = vscode` 且 `kind = container` 的 `ViewGroupDeclaration`。binding kind 在声明时确定，不从 group 内容推断。group 的数据面是 `ViewGroupState`，运行时是 frame 的 `ViewGroup`。

## Motivation

当前 adaptor 直接把 `ViewPane` 挂进 frame 给的 host；它没有 `ViewPaneContainer` 这一层。后果：

- container 的多个 view 同时可见、顺序、collapse、visibility 没有统一 owner；
- `ViewContainerTitle` 的 actions / context keys 没有稳定的承接位置；
- view 移出原 container 后，`ViewPane` 仍按来源注册关系查 container，G 无法自然成立；
- container bar 与 group bar 的分工没有落点；
- 一个 container 里混放 VS Code view 和 DSH view 时，谁创建 host、谁管可见性不清楚。

UI umbrella 已经定了方向和 G：container 是 prac 的组合单元，container 的 title actions / context keys 归当前 container；view 自己的 title actions / `viewsWelcome` 跟随。现在需要把这条 policy 变成 adaptor 的机制。

## 约束

- **container = 具名 view group，默认 stack**；成员由 placement 派生，不由来源的 view 集合拥有。
- **view group 是 region 的内容根**；container 不是一个独立的布局节点。
- **editor group = select view group + editor binding**；它不是 prac 类型，具体的 `PracEditorGroup` / `EditorGroupModel` 在 adaptor 里。
- **DSH view 可以进 VS Code container**；VS Code view 可以移出到 DSH group。
- **G**：view 移出原 container 后，container 的 title actions / context keys 归当前 container；view 自己的 title actions / `viewsWelcome` 跟随；原 container 的 actions / context keys 不跟随。
- **frame 不认识 VS Code container**：container context 在 adaptor 内部，frame 只看到 view group / host。
- **container context 不能成为第二成员权威**：它承接 VS Code 语义，但 view 是否在 container 里仍由 prac placement 决定。
- **group 是 frame 的**：`ViewGroup`（运行时）/ `ViewGroupState`（数据）/ active / order 都在 frame；`VscodeGroupBinding` 是 adaptor 侧的 `ViewGroup.binding?`。
- **binding kind 只有两种**：`vscode/container` / `vscode/editor`；kind 由 `ViewGroupDeclaration` 的 `source + kind` 在声明时确定，不由 group 内容推断。
- **没有 `view-host` binding**：VS Code view 被移到 plain group 时，没有 group binding；`VscodeViewHost` 用 unbound context 挂载。
- **group mode 与 binding kind 不是同一个轴**：group mode 是 `stack` / `select`；binding kind 是 `container` / `editor` / none。前者决定内容怎么显示，后者由 group declaration 决定。
- **`IViewsService` 用 external view registry**：`VscodeViewHost` 注册 / 注销 `ViewPane`；`getViewWithId` / `getActiveViewWithId` / `isViewVisible` 优先查 registry；没有 container binding 时，container 级方法返回 `null` / 不可用。
- **container bar / group bar 由 frame 画**：adaptor 提供 action / context，不自己画第二套 bar。
- **`paneHeader` 是 view 自报的呈现事实**：frame 用它决定是否保留 native pane header，不按来源前缀猜。
- **`PracLayoutFace` 以 view group / grid cell 为落点**：region 只是几何槽位；editor group 的 `addGroup` 走 group / cell channel，不是只建 region。
- **role 名是 `stage` / `primary sidebar` / `secondary sidebar` / `panel`**：left / center / right / bottom 只是默认物理位置。

## 设计空间

目标是 **`VscodeGroupBinding`**；下面的 A–D 是 container context / binding 内部实现的不同机制，不是 group 的 owner。

### A. headless real `ViewPaneContainer`

为每个 container group 创建一个不挂到 part composite 的真实 `ViewPaneContainer`，由它创建 / 移除 `ViewPane`、承接 title / menu / collapse / visibility。

- **优点**：最大化复用上游 container 语义；`ViewPane` 查到的 container 是真实的；title actions / context keys 自然。
- **风险**：`IViewsService` 注册点、headless container 的可见性 / focus、与 frame stack 的尺寸关系；DSH view 不是 `ViewPane`，需要额外的 wrapper pane 或旁路 host。
- **关键问题**：`ViewPaneContainer` 能不能接受非 `ViewPane` 的成员，还是只能在它旁边再放一个 host？

### B. 最小 container context

adaptor 自己维护 container 的 view 列表 / 可见性 / 顺序 / actions，只借用 upstream 的 `ViewPane` 作为单 view host。

- **优点**：DSH view 与 VS Code view 可以走同一个 container host；不依赖 `IViewsService` 注册。
- **风险**：容易重实现 container 语义；title / menu / context / drag / drop / collapse 都要自己接；可能变成第二个 `ViewPaneContainer`。
- **关键问题**：哪些行为可以只做最小集，哪些必须借 upstream？

### C. 不做 container context

维持当前直接挂 `ViewPane` 的方式，只保留 view 级 actions。

- **优点**：改动最小。
- **风险**：container 的 stack / 多 view / container actions / context keys 无法成立；G 无法满足；Explorer 这类 container 会退化。
- **结论**：只能作为 baseline / 反例，不作为目标。

### D. 混合 container host

container context 拥有一个 stack，成员是 host，不要求成员是 `ViewPane`；VS Code view 的 host 是 `ViewPane`，DSH view 的 host 是 React host。

- **优点**：直接对应“container 是 prac 的 stack view group”；天然支持跨来源。
- **风险**：container 的 title / menu / context 仍要借 upstream 或自己接；`ViewPane` 仍会查来源 container，G 需要额外覆盖；collapse / visibility / focus 要统一。
- **关键问题**：container context 是“host stack owner”，还是“VS Code container 的 runtime”？两者边界要划清。

## Spike

先做最小实验，不写产品代码：

1. Explorer container 同时显示 Open Editors / Folders / Outline，确认它是 stack，不是 select；
2. 往 Explorer container 里放一个 DSH React view；
3. 把 Folders 移到一个 DSH group（plain group，没有 group binding）；
4. 额外验证 stage grid cell ↔ view group ↔ editor group 的映射：`addGroup` / `setGroupRegionChannel` 能否创建 grid cell / select view group，而不是只建 region；
5. 记录 external view registry：Folders 的 `ViewPane` 在新 group 下 `getViewWithId` / `isViewVisible` / focus 是否走 binding 注册；container 级方法是否返回 `null`；
6. 记录：
   - container bar 是否仍切 container；
   - Folders 的 title / icon / `viewLocation` / `ViewTitle` actions 是否错位；
   - Explorer 的 `ViewContainerTitle` actions 是否还作用于已移出的 view；
   - DSH view 在原 container 里是否获得尺寸 / focus；
   - collapse / visibility / focus 是否冲突；
   - `IViewsService.getViewWithId` / container model 的返回。

## Open questions

1. **container context 的 owner**：一个 container group 一个 context，还是一个 VS Code `ViewPaneContainer` 对应一个 prac container？
2. **混合成员**：`ViewPaneContainer` 能否承载 DSH view 的 host；如果不能，是由 wrapper pane 还是旁路 host 承担？
3. **注册点**：headless `ViewPaneContainer` 要不要注册进 `IViewsService`；注册后如何避免它成为第二成员权威？
4. **G 的投影**：view 移出后，`viewContainer` / `viewLocation` / `ViewContainerTitle` 的 context 在哪里覆盖、哪里抑制、哪里接受失效？
5. **action / menu**：view-scoped / container-scoped / global 的 owner 与 scope 怎么判？
6. **focus / visibility / collapse**：upstream container 的语义与 frame 的 stack/fold 如何不打架？
7. **`IViewsService` 注册**：subclass 还是 patch `ViewsService`；`getActiveViewWithId` / container 级方法在 plain group 下如何返回；`focusedViewContextKey` 谁维护？
8. **editor group**：`EditorGroupBinding` 是否复用同一套 binding 基类，还是保持 editor 专用链？

## Validation

这个 step 完成的判据：

- 一个机制被选中，并写清 owner 表；
- Explorer 的 stack 行为、container bar、container actions 成立；
- DSH view 能进入 VS Code container，且不出现第二成员权威；
- Folders 移出后，G 的 title actions / context keys 行为符合决策；
- collapse / visibility / focus 有一致行为；
- stage 的 grid cell / select view group / editor group binding 能建立，不出现第二成员权威；
- container bar / group bar 由 frame 画，adaptor 只供 action / context；
- plain group 的 `ViewPane` 仍能被 `IViewsService` 找到；container 级 actions / context keys 不出现；
- `VscodeViewHost` 的注册 / 注销与 `PracViewsService` 的 external registry 一致；
- spike 记录能支持或推翻所选机制。

## Related

- [2026-10-17-vscode-host-architecture.md](../in-progress/2026-10-17-vscode-host-architecture.md)：adaptor 的层、对象、契约与 surface。
- [2026-10-20-ui-framework.md](../in-progress/2026-10-20-ui-framework.md)：UI umbrella；container / view group / placement / G。
- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：view catalogue。
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：editor host。
