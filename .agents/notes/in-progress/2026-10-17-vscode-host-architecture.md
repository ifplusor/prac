---
status: in-progress
---

# Agent Note: vscode-host — 把 VS Code 的 UI 贡献翻译成 prac 的组合资源

> **这是哪件工作**：prac 的 VS Code adaptor（`vscode-host`）。它是 prac UI 的 sub-umbrella，定义 adaptor 的边界、对象、契约、生命周期与 surface ownership。
> **关系**：UI umbrella 见 [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)；总集成 umbrella 见 [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)；container context 见 [2026-10-22-vscode-container-context.md](../proposed/2026-10-22-vscode-container-context.md)。
> **状态**：已接受为方向（in-progress）。每个 surface 的机制留给自己的 step。

## Summary

`vscode-host` 不拥有 prac 的 view group，也不根据 group 内容推断 group 类型。

它做三件事：

1. **翻译** VS Code 的 container / view 为 prac 的 CR 风格声明：
   - `ViewGroupDefinition` / `ViewGroupDeclaration`
   - `ViewDefinition` / `ViewDeclaration`
2. **提供 VS Code runtime**：
   - `VscodeGroupBinding` 只挂到 `vscode.prac/v1` 的 `Container` / `Editor` 声明；
   - `VscodeViewHost` 为每个 VS Code view 提供 `ViewPane` / `EditorPane` host。
3. **注册运行时查找**：
   - `PracViewsService` 通过 external view registry 让 `IViewsService` 找到 prac 管理的 view；
   - external registry 由 `VscodeViewHost` 注册 / 注销。

frame 仍然拥有 `ViewGroupState` / `ViewGroup`、placement、active、order、container bar / group bar。

## Motivation

VS Code 的 UI 模型是 part / container / pane / view / editor group；prac 的模型是 region / `ViewGroup` / `View` / placement。

如果 adaptor 直接把 `ViewPane` 挂进 frame：

- container 的 view 集合、可见性、顺序、collapse、title / menu 没有统一 owner；
- `ViewPane` 仍按来源注册关系查 container，G 无法成立；
- group 的 binding 只能从 group 内容猜，导致“vscode-host 处理 group 内容”的错位；
- container bar / group bar 可能有两套 owner。

因此 adaptor 的职责是：

> **把 VS Code 声明翻译成 prac 可消费的资源；把 VS Code runtime 接到这些资源上。**

不是：

> 拿到一个 prac group，再决定它应该怎么处置。

## 1. 边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| **frame / ui-layout** | 布局拓扑、`ViewGroupState` / `ViewGroup`、placement、active、order、stack / fold / sash、container bar / group bar | VS Code 的 part / container / pane / view 语义 |
| **vscode-host（adaptor）** | VS Code 的 view / editor / container / action / overlay / webview 语义；declaration；catalogue；face；binding；view host；生命周期 | prac 的布局、group state、成员关系 |
| **vendor/vscode-embed** | boot、资产、宿主元素、命令面、bridge | 政策：哪个 workspace、哪些 view、怎么摆 |
| **vendor/vscode** | 上游 workbench（pin + patch + overlay） | prac 的词与政策 |
| **DSH** | shell、运行时、槽、服务、session | VS Code 的 UI |
| **consumers** | `ui-vscode-views` / `ui-vscode-editor` / arrangement | adaptor 内部 |

关键句：

> **frame 不认识 VS Code；adaptor 不拥有 group runtime，也不拥有 group 成员。**
> adaptor 声明 `ViewGroupDeclaration` / `ViewDeclaration`；frame 决定 group / placement；binding 和 view host 只承接 VS Code runtime。

### 1.1 core workbench 与 extension

- **core workbench** 是 adaptor 内部的 host / engine：workbench 服务、`IViewsService`、`IEditorGroupsService`、`IContextViewService`、overlay。
- **built-in / external extension** 是 contributor：只用 `vscode.*` 与 `contributes`；没有 DOM，没有内部服务，不能新增 part。
- adaptor 在 ownership / capability 上区分 core 与 extension；
- 在 catalogue / declaration / `prac.view` / action 上不区分：core view 与 extension view 走同一套契约。

## 2. Guide-level design

### 2.1 两类资源

| 资源 | CRD | CR | materialize |
| --- | --- | --- | --- |
| **group** | `ViewGroupDefinition` | `ViewGroupDeclaration` | `ViewGroupState` → `ViewGroup` |
| **view** | `ViewDefinition` | `ViewDeclaration` | `View` + `ViewHost` |

两者共用 CR 信封：

```ts
interface Resource<TSpec> {
  apiVersion: string;
  kind: string;
  metadata: { id: string; labels?; annotations? };
  spec: TSpec;
}
```

- `apiVersion + kind` 是类型，声明时确定、不可变；
- `metadata` 是身份；
- `spec` 是可变配置；
- frame 把类型当 opaque，只通过 `ViewGroupDefinition` / `ViewDefinition` 查 schema / validation / factory。

### 2.1.1 CRD-lite：复杂度预算

只借 CRD 的 **类型 / 实例分离**，不把 Kubernetes 的控制器框架搬进 prac：

| 保留 | 不做 |
| --- | --- |
| 2 类资源：`ViewGroup` / `View` | 通用 resource framework |
| 1 个 CR 信封：`apiVersion / kind / metadata / spec` | 任意 UI 概念都做 CRD |
| 1 个 definition registry（`Map`） | API server / etcd / watch / informer |
| 1 个 materializer：declaration → state → runtime | controller / operator / reconcile loop 框架 |
| `validate` / `default` / factory 函数 | JSON Schema / admission webhook / conversion webhook |
| 一个 declared group 最多一个 group binding | 多 binding / attachment 层 |
| 一个 view 一个 view host | `status` / conditions / finalizers / ownerReferences |

- **只有 view 和 view group 是 CR**；action / overlay / part / host 仍走各自的 contribution 模型，不 CRD 化。
- **Definition 是 TypeScript 接口 + 函数**，不是独立的 schema 服务。
- **kind 不可变**；第一版不做多版本转换，只保留 `apiVersion` 字段。
- **一个 group 只有一个 declaration 来源**；不做多 source 合并 group kind。
- **不加 `GroupHost` / attachment / multi-binding**；`ViewGroup.binding?` 已经够用。


### 2.2 group

```text
ViewGroupDefinition（CRD）
  apiVersion / kind / schema / validation / bindingFactory
        ↓
ViewGroupDeclaration（CR）
  apiVersion / kind / metadata / spec
        ↓
ViewGroupState（prac 数据）
  id / mode / active / order / tombstone / placement
        ↓
ViewGroup（frame 运行时）
  slots / hosts / binding?
```

- `ViewGroupDefinition` 由 source adapter 注册；
- `ViewGroupDeclaration` 由 source adapter 产生；
- `ViewGroupState` 由 arrangement / frame materialize；
- `ContainerRecord` 由 arrangement 的 view group registry 写入，随 `ViewGroupState` 进 frame 的 layout store；source 不写 record；
- source 卸载时 record 可 tombstone，不自动删除。

**group kind 决定 binding**：

| kind | group mode | binding |
| --- | --- | --- |
| `vscode.prac/v1 Container` | `stack` | `ContainerBinding` |
| `vscode.prac/v1 Editor` | `select` | `EditorGroupBinding` |
| plain group | `stack` / `select` | none |

- binding 不跟 view 走，跟 declaration 走；
- view 移出 container 后，原 container group 的 binding 仍在；
- plain group 可以放 VS Code view，但没有 group binding，由 `VscodeViewHost` 用 unbound context 挂载。

### 2.3 view

```text
ViewDefinition（CRD）
  apiVersion / kind / schema / validation / hostKind / hostFactory
        ↓
ViewDeclaration（CR）
  apiVersion / kind / metadata / spec
        ↓
View（prac runtime）
  ViewHost（react / view-pane / editor-pane / slot / opaque）
```

- `kind` 是 view 类型；
- `hostKind` 是执行能力；
- 两者不混；
- `prac.view` 承载的是 `ViewDeclaration`；
- `containerId` 只是默认落位 hint，不是成员关系；
- view 是否存在由 source catalogue 决定，placement 由 frame 决定。

### 2.4 runtime 对象

#### consumer 面

| 对象 | 作用 |
| --- | --- |
| `PracVscodeFace` | catalogue / `hostFor` / `focusView` / `runCommand` / file placement / capabilities |
| `VscodeCatalogueEntry` | catalogue 一行：`view` / `appId` / `title` / `source` / `role` / `containerId` / `containerTitle`（`role` 和 `containerId` 只是默认提示） |
| `ViewGroupDefinition` / `ViewDefinition` | 由 source adapter 注册的 CRD |
| `ViewGroupDeclaration` / `ViewDeclaration` | source 产生的 CR |
| `prac.view` | `ViewDeclaration` |

#### adaptor / workbench

| 对象 | 作用 | 不知道 |
| --- | --- | --- |
| `VscodeEmbedHandle` | boot / `view` / `file` / `placements` / `views` / `floatHost` / group-cell channel | frame 的 layout |
| `WorkbenchFace` | workbench 对 embedder 的内部面：mount / focus / release / capabilities；不承载 part mount | consumers |
| `EmbeddedWorkbench` | workbench 本体：服务、view / editor runtime、overlay | frame |
| `PracEditorHost` | adaptor 侧 editor runtime 服务：`IEditorGroupsService`、`EditorGroupModel`、editor panes | prac editor group 类型 |
| `VscodeGroupBinding` | `ViewGroup.binding?`：只匹配 `vscode.prac/v1 Container / Editor`；提供 group-level context / actions；不拥有 view host | group state / placement |
| `VscodeViewHost` | 每个 VS Code view 的 runtime host：mount / release `ViewPane` / `EditorPane`；注册 / 注销 `IViewsService`；有 group binding 时用其 context，否则 unbound | group state / placement |
| `PracViewsService` | `IViewsService` 的 subclass / patch：external view registry；其余方法 delegate | group state / placement |
| `ViewPane` / `ViewPaneContainer` | 上游 view / container runtime；`ViewPaneContainer` 只是 `ContainerBinding` 内部实现 | frame / prac 成员 |

#### frame 契约

| 对象 | 作用 |
| --- | --- |
| `PracLayoutFace` | 布局拓扑、view group、placement、grid cell、尺寸 |
| `ViewGroupState` / `ViewGroup` | group 的数据 / 运行时；binding 是 runtime-only 字段 |
| `ContainerRecord` | 具名 group 的 materialized record；registry 写，layout store 持久化 |

## 3. Reference-level

### 3.1 声明契约

```ts
interface ViewGroupDefinition {
  apiVersion: string;
  kind: string;
  validate(spec: unknown): void;
  default(spec: unknown): unknown;
  bindingFactory?(spec: unknown): GroupBinding | undefined;
}

interface ViewGroupDeclaration extends Resource<Record<string, unknown>> {}

interface ViewDefinition {
  apiVersion: string;
  kind: string;
  validate(spec: unknown): void;
  default(spec: unknown): unknown;
  hostKind: HostKind;
  hostFactory(decl: ViewDeclaration): ViewHost;
}

interface ViewDeclaration extends Resource<ViewSpec> {}
```

- `Definition = 类型 / CRD`；
- `Declaration = 实例 / CR`；
- `ViewGroupDeclaration.kind` 决定 `bindingFactory`；
- `ViewDeclaration.kind` 决定 `hostFactory` / `hostKind`；
- 没有 `source` 作为独立字段；`apiVersion` 已经表达来源；
- kind 改变 = 新 CR / 迁移，不是改字段。

### 3.2 group binding

`ViewGroup.binding?` 只由 declaration 的 `apiVersion + kind` 决定：

| declaration | binding |
| --- | --- |
| `vscode.prac/v1 Container` | `ContainerBinding` |
| `vscode.prac/v1 Editor` | `EditorGroupBinding` |
| 其它 / plain | none |

不根据 group 里的 view 推断。

- `ContainerBinding`：container context、view collection / visibility / order / collapse、container actions；
- `EditorGroupBinding`：`EditorGroupModel`、editor group context、editor actions；
- frame 拥有 group 的 mode / active / order / bar；
- binding 只提供 group-level runtime / action / context。

### 3.3 view host

`VscodeViewHost` 是 per-view：

```ts
interface VscodeViewHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly viewId: string;
}
```

- mount：创建 `ViewPane` / `EditorPane`，注册 external view；
- release：注销 external view，dispose；
- 没有 group binding 时，使用 unbound context；
- `IViewsService` 的 external registry 由 host 维护，不由 group binding 维护。

### 3.4 frame 契约

- `PracLayoutFace` 的 placement 目标是 `viewGroupId`；
- group / cell channel 创建 **grid cell / select view group**，不是只建 region；
- container bar / group bar 由 frame 画；
- adaptor 提供 action / context，不画第二套 bar；
- `PracLayoutFace` 不暴露 VS Code part / container 语义。

### 3.5 状态归属

| 状态 | 谁拥有 | 持久化 |
| --- | --- | --- |
| workspace / session | DSH | — |
| layout topology / view group / placement / active / order | frame | 是 |
| `ContainerRecord` / metadata | arrangement registry | 是（layout store） |
| `ViewGroupDefinition` / `ViewDefinition` | adaptor | 否（source 重建） |
| `ViewGroupDeclaration` / `ViewDeclaration` | adaptor / consumers | 否（source 重建） |
| `VscodeGroupBinding` / `VscodeViewHost` | adaptor | 否 |
| `IViewsService` external registry | adaptor | 否（runtime） |
| view existence / availability | source catalogue | 否 |
| overlay / focus / attention | frame / arrangement | 否 |

### 3.6 生命周期

**正常启动**

1. frame 恢复 layout / group state；
2. adaptor 注册 `ViewGroupDefinition` / `ViewDefinition`；
3. adaptor 产生 `ViewGroupDeclaration` / `ViewDeclaration`；
4. arrangement materialize `ViewGroupState` / `ViewGroup`；
5. 对 `vscode.prac/v1 Container / Editor` group 创建 `VscodeGroupBinding`；
6. frame 挂载 view 时，`VscodeViewHost` mount / 注册 external registry。

**recovery / reload**

- declaration / definition 不持久化，由 source 重建；
- layout / `ContainerRecord` 从 layout store 恢复；
- binding 按 declaration 的 `apiVersion + kind` 重建；
- 不根据 group 内容推断，也不依赖 attach 顺序。

**动态安装 / 卸载**

- 安装：新 definition / declaration；arrangement 落位；binding / view host 随声明创建；
- 卸载：declaration 消失，binding / view host 释放；layout placement 可 tombstone；
- reload：同 recovery；旧 runtime 不保留。

### 3.7 失败与顺序

- 没有 workspace：不 boot；
- catalogue 为空：consumer 等 `pracVscode`，不缓存空目录；
- workbench 未启动：不创建半成品 pane；
- declaration 无效：诊断，不 materialize；
- view 已注册但未落位：host 不渲染；
- source 卸载：只移除自己的 view，不删别家 group；
- code server / workbench 失败：adaptor 报错，frame 不接管启动。

## 4. Surface ownership

| surface | VS Code 侧 | owner | step |
| --- | --- | --- | --- |
| part / region | titlebar / banner / activitybar / primary sidebar / secondary sidebar / panel / statusbar；`Layout`/`Grid` | frame 负责布局与 role；adaptor 负责 part 语义 | future part context |
| view container / view | `ViewContainer` / `ViewPaneContainer` / `ViewPane` / `ViewContainerModel` | adaptor 翻译为 declaration；frame 拥有 group / placement；binding / view host 承接 runtime | [container context](../proposed/2026-10-22-vscode-container-context.md) |
| action / menu | `ViewTitle` / `ViewContainerTitle` / `commands` / `keybindings` / `menus` | adaptor 供 action / context；frame 画 bar | future action/menu context |
| status bar / overlay | status bar item；notifications / quick pick / input / dialog / context view / hover | adaptor 供内容；frame 供 overlay layer；source-managed behavior | future overlay/status context |
| webview / custom editor | webview view / panel；custom editor | adaptor | future webview/editor context |
| editor content UI | decorations / hover / CodeLens / Inlay Hints / semantic tokens | adaptor（editor chain） | future editor content context |
| 专用视图 | SCM / comments / timeline / tests / debug / task / terminal / notebook / chat | adaptor；多数是 view + action，部分需要 controller | future specialized views |
| 主题 / 设置 / walkthrough | themes / icon themes / configuration / walkthroughs | adaptor + frame 的主题/设置面 | future themes/settings |

### 4.1 container / view surface

当前事实：

- `tryMountView` 直接创建 `ViewPane`，没有 group binding；
- `PracViewsService` 让 mounted pane 可按 id 解析；`Collapse Folders` 已验证；
- view 集合 / 可见性 / 顺序 / size / container title / menu / `viewsWelcome` 仍缺；
- `ViewTitle` / `ViewItemContext` 的 action 可挂在 view 上。

目标：

- group 由 frame 拥有；
- `vscode.prac/v1 Container` / `Editor` 声明才有 binding；
- `VscodeViewHost` 负责每个 VS Code view 的 mount / release；
- `IViewsService` 的 external registry 由 view host 注册；
- G：view 移出原 container 后，原 container actions / context keys 不跟随；view actions / welcome 跟随；
- frame 画 container bar / group bar；adaptor 供 action / context；
- `paneHeader` 是 view 自报的呈现事实，不是 source marker。

## 5. Drawbacks

- **container 语义不随 view 走**：`ViewPane` 仍会按来源注册关系查 container，G 需要覆盖 / 抑制；
- **webview / iframe reload**：host 重挂会换 browsing context；
- **editor 跨 group 不是纯 host 搬运**：可能 `moveEditor`，activation 必须显式；
- **`IViewsService` 需要 patch / subclass**：external view registry 不是上游原生能力；
- **declaration 不持久化**：source 不在时只能 tombstone placement，不能恢复 view；
- **group kind 不可变**：kind 变化要走新 declaration / migration。

## 6. Non-goals

- 不采用 VS Code 的顶层布局；
- 不做完整 part / pane composite；
- 不把 frame 的 stack / grid 塞进 adaptor；
- 不让 frame 认识 VS Code 的 part / container / pane / editor group；
- 不把 container 的 owner 放回 frame；
- 不暴露 part host，也不把整块 VS Code part 当兜底；
- 不按 core / extension 分 view 渲染路径；
- 不把 core workbench 当普通 extension 重建。

## 7. Steps

- [view catalogue](2026-10-06-vscode-view-catalogue.md)（in-progress）；
- [editor host](2026-10-07-editor-host.md)（in-progress）；
- **container / view**：[container context](../proposed/2026-10-22-vscode-container-context.md) 已开 step；
- action / menu；
- status bar / overlay；
- webview / custom editor；
- editor content UI；
- 专用视图；
- themes / settings / walkthroughs。

frame 侧（stack chrome / grid）不属于这张 note 的 steps，见各自的 note。

## 8. Open questions

- **`IViewsService` external registry**：subclass 还是 patch `ViewsService`；`getActiveViewWithId` / container 级方法在 plain group 下如何返回；`focusedViewContextKey` 谁维护。
- **container context**：headless `ViewPaneContainer`，还是更小的 context？见 [container context](../proposed/2026-10-22-vscode-container-context.md)。
- **part context**：frame 的 role（`stage` / `primary sidebar` / `secondary sidebar` / `panel`）与 VS Code 的 part 如何对应；left / center / right / bottom 只是默认物理位置。
- **action / menu scope**：view-scoped / container-scoped / global 的边界。
- **overlay**：frame-hosted、source-managed 是否足够；frame-managed `pracOverlay` 何时需要。
- **webview / custom editor**：是否共用同一个 host 契约。
- **editor content UI**：属于 editor host 还是独立 context。
- **boot**：`pracVscode` service 与 workspace / code server 的生命周期顺序。
- **catalogue**：catalogue 是唯一入口，还是允许 consumer 直接问 `IViewDescriptorService` / `IEditorService`。

## 9. Validation

- **声明翻译**：VS Code container / view → `ViewGroupDeclaration` / `ViewDeclaration`；kind 在声明时确定；
- **binding 不跟 view**：Folders 移出 Explorer 后，Explorer group 的 ContainerBinding 仍在；目标 plain group 没有 binding；
- **view host**：移动后的 Folders 仍由 `VscodeViewHost` 挂载，`IViewsService.getViewWithId` 可找到；
- **G**：原 container actions / context keys 不跟随；view actions / welcome 跟随；
- **group mode**：Explorer 多 view 同时可见；editor group 是 select；
- **recovery**：reload 后 definition / declaration 重建，binding 按 declaration 重建，不根据 group 内容推断；
- **动态安装 / 卸载**：declaration 增减，binding / view host 同步；
- **overlay**：VS Code float host 与 DSH overlay 同层按 order 共存；
- **frame 无 source 分支**：不 import / eval source bundle，不按 `vscode:` 前缀分派。

## Related

- [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)：总 umbrella。
- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：UI umbrella；view group / placement / G。
- [2026-10-22-vscode-container-context.md](../proposed/2026-10-22-vscode-container-context.md)：container context step。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：视图隔离、区域骨架。
- [2026-10-06-vscode-view-catalogue.md](2026-10-06-vscode-view-catalogue.md)：view catalogue。
- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：editor host。
- [2026-10-17-stack-view-chrome.md](2026-10-17-stack-view-chrome.md)：frame 侧 stack chrome。
- [2026-10-15-ui-layout-grid.md](../proposed/2026-10-15-ui-layout-grid.md)：frame 侧 grid。
- [docs/architecture.md](../../../docs/architecture.md)：prac 目标架构。
- [docs/concepts.md](../../../docs/concepts.md)：prac 词表。
- [docs/vscode.md](../../../docs/vscode.md)：VS Code 自身结构。
