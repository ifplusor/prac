---
status: proposed
---

# Agent Note: vscode-host 的架构 —— adaptor 的层、契约与 surface

> **这是哪件工作**：prac 的 VS Code 面需要一个 adaptor；这张 note 是 adaptor 的 **sub-umbrella**，定义它的职责边界、层、契约、生命周期、non-goals 与 surface ownership。总 umbrella 见 [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)。
> **状态**：提出，未裁。这里只定骨架；每个 surface 的具体设计留给 step。

## Problem

adaptor 侧已经有几个 step，但缺一张骨架：

- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：view 目录；
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：编辑器宿主；
- container context：先于 architecture 写成，把 collapse 的修法上升成 container 机制；
- surface map：是清单，不是设计。

没有骨架的后果：

- 每个 surface 都被当成一次性问题；
- step 会先选机制（例如 headless `ViewPaneContainer`），再倒推 architecture；
- frame、adaptor、vendor、consumers 的职责会混；
- 扩展 UI 的 surface 范围没有 owner；
- 生命周期（boot / view / editor / overlay / dispose）没有统一说法。

## 范围

- 这张 note 是 **adaptor 的 architecture**，不是整个 prac UI 的 architecture；
- frame 侧（区域、stack、fold、sash、grid）另有一条线，见 [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)、[2026-10-15-ui-layout-stack.md](../resolved/2026-10-15-ui-layout-stack.md)、[2026-10-17-stack-view-chrome.md](../in-progress/2026-10-17-stack-view-chrome.md)、[2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)；
- 这里不设计每个 surface；只定骨架与 surface ownership；
- 这里不替代总 umbrella；它是总 umbrella 下的一个 sub-umbrella。

## 1. 职责边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| **frame** | 区域 / stack / fold / sash / 拖拽；给 view 盒子 | VS Code 的 part / container / pane / view 语义；扩展 UI 的内容 |
| **vscode-host（adaptor）** | VS Code 的 part / container / pane / view / action / overlay / webview / editor 语义；catalogue；face；生命周期 | prac 的布局；DSH 的运行时；frame 内部 |
| **vendor/vscode-embed** | 机制：boot、资产、宿主元素、命令面、bridge | 政策：哪个 workspace、哪些 view、怎么摆 |
| **vendor/vscode** | 上游 workbench（pin + patch + overlay） | prac 的词与政策 |
| **DSH** | shell、运行时、槽、服务、session | VS Code 的 UI |
| **consumers** | `ui-vscode-views` / `ui-vscode-editor` / arrangement | adaptor 内部 |

关键句：

> **frame 不认识 VS Code；adaptor 不持有 / 修改 frame 的内部布局状态，只通过 `PracLayoutFace`（`ctx.pracLayout`）、`prac.view`、host element 这些窄契约协作；vendor 不认识 prac 的政策。**

## 2. 层与包

```text
DSH shell / slots / services
  └─ prac-web-app + ui-layout（frame）
       ├─ ui-vscode-views（consumer：view entries）
       ├─ ui-vscode-editor（consumer：file entries）
       └─ vscode-host（adaptor）
            ├─ catalogue / face / host
            ├─ view container context（future step）
            ├─ editor host（step）
            └─ vendor/vscode-embed（mechanism）
                 └─ vendor/vscode（upstream）
```

- **`vendor/vscode`**：上游源码 + patch + overlay；不出现 prac 词。
- **`vendor/vscode-embed`**：prac-free 的 wrapper lib；只给机制，不背政策。
- **`vscode-host`**：adaptor/policy；把 VS Code 的 UI 语义翻成 prac 可用的 catalogue / face / view host / editor host / overlay / action。
- **consumers**：按 DSH 的形式消费 face / catalogue；不碰 adaptor 内部。
- **frame**：只接收 `prac.view` 和 view 盒子；不认 part/container/pane。

### 2.1 运行时拓扑

```text
Browser
  DSH shell（prac-web-app + ui-layout frame）
    ├─ vscode-host plugin（client）
    │   ├─ PracVscodeFace → ctx.pracVscode
    │   ├─ createVscodeEmbed → VscodeEmbedHandle
    │   └─ vendor/vscode EmbeddedWorkbench
    ├─ ui-vscode-views（source: "view"）
    ├─ ui-vscode-editor（source: "file"）
    └─ arrangement（web-app：place / placeQuietly）
Server（node）
  prac-host-vscode
    └─ code server
         └─ extension host（UI 宿主，和 agent 的 P1 宿主分开）
```

- `vscode-host` 的 `apply()` 先 `createVscodeEmbed({ route, productName, extensionsGallery })`；
- 在 boot 之前用 `ctx.pracLayout` 装好 `setGroupRegionChannel`（`createRegionBeside` / `regionInDirection` / `removeRegion`），因为编辑器组的 `addGroup` 要同步建区域；
- **workspace 是 window identity**：只有 `ctx.workspaces` + `ctx.uiSession` 能确定当前 workspace 时才 `embed.boot({ workspacePath, configurationDefaults: { "files.autoSave": "off" } })`；一个页面只 boot 一次；
- `ctx.provide("pracVscode", face)`；`shell.overlay` 注册 `embed.floatHost()`（`order: -100`，prac 自己的 overlay 在上）；
- consumers 通过 `inject: ["pracVscode"]` 等这个 service；frame 通过 `ctx.pracLayout` 提供区域/放置。

### 2.2 核心对象模型

| 对象 | 在哪 | 持有什么 | 谁调用 |
| --- | --- | --- | --- |
| `PracVscodeFace` | `packages/client/vscode-host/src/client/public.ts` | catalogue、`hostFor`、`focusView`、`runCommand`、file placement、capabilities | consumers、诊断/门 |
| `VscodeEmbedHandle` | `vendor/vscode-embed/src/client/index.ts` | boot、`partHost`、`view`、`file`、`placements`、`views`、`floatHost`、group region channel | `vscode-host` |
| `PartHostFace` | `vendor/vscode/overlay/embedBridge.ts` | workbench 侧的 mount/focus/release/list、file placements、capabilities | `vscode-embed` |
| `EmbeddedWorkbench` | `vendor/vscode/overlay/embeddedWorkbench.ts` | workbench 服务、`IWorkbenchLayoutService`、view/editor host、overlay | `PartHostFace` |
| `PracEditorHost` | `vendor/vscode/overlay/pracEditorHost.ts` | `IEditorGroupsService`、group / region、editor group model/panes | workbench、`vscode-host` 的 region channel |
| `ViewPane` / `ViewPaneContainer` | 上游 workbench | 一个 view 的 pane / 一个 container 的运行时 | `tryMountView` / container context |
| `VscodeCatalogueEntry` | `vscode-host` 的 face | `view` / `appId` / `title` / `source` / `location` / `containerId` / `containerTitle` / `region` | `ui-vscode-views` / `ui-vscode-editor` / arrangement |
| `PracLayoutFace` | `packages/client/ui-layout/src/client/contract.ts` | 区域树、view 放置、区域创建/删除 | adaptor、arrangement、editor host |
| `prac.view` | `ui-layout` 的 slot | 每个 view 的一次注册（id/label/icon/宿主组件） | consumers |

### 2.3 状态归属

| 状态 | 归谁 |
| --- | --- |
| workspace / session identity | DSH |
| 区域树、放置、stack/tab/fold/sash、持久化 | frame（`ui-layout`） |
| workbench、view pane、editor group、container context、overlay | adaptor（`vscode-host` / workbench） |
| view catalogue（文件 + 视图） | adaptor（来自 `IEditorService` / `IViewDescriptorService`） |
| `prac.view` 注册 | consumers |
| capabilities（editors / diagnostics） | adaptor 计算；consumers 只读 |

关键：**frame 不持有 workbench 状态；adaptor 不持有 layout 状态**。两边通过 `PracLayoutFace`、`prac.view`、host element 协作。

## 3. 契约

### 3.1 已有契约

- **`PartHostFace` / `VscodeEmbedHandle`**：mechanism 面。
  - 宿主元素（partHost / view host / float host）；
  - 命令面；
  - focus / layout；
  - 不涉及 prac 的布局。
- **`PracVscodeFace`**：adaptor 面。
  - `catalogue()` / `onDidChangeCatalogue()`；
  - `hostFor(view)`；
  - `focusView(view)`；
  - `runCommand(command, ...args)`；
  - 后续按 surface 增加，不把 frame 的内部暴露出去。
- **`prac.view`**：view 注册缝。
  - frame 只按注册表成员判定；
  - `containerId` / `containerTitle` 只是元数据；
  - 不代表 container 是 frame 的 owner。

### 3.2 未来契约

- **view action / container action**：`ViewTitle` / `ViewContainerTitle` 的 owner 与 scope；
- **container context**：view container / view surface 的 runtime；
- **part context**：frame 的顶层区域 ↔ VS Code 的固定 part；
- **overlay context**：status bar / notifications / quick pick / dialog / context view / hover；
- **webview / custom editor context**；
- **editor content context**：decorations / hover / CodeLens / Inlay Hints。

这些契约未定；不要在 step 里先写成既成事实。

## 4. 生命周期与序列

### 4.1 boot / workbench

1. DSH 加载 `prac-client-vscode-host`；`apply()` 创建 `VscodeEmbedHandle`；
2. `setGroupRegionChannel` 绑定 `ctx.pracLayout`；
3. 等 `ctx.workspaces` + `ctx.uiSession` 给出当前 workspace；
4. `embed.boot({ workspacePath, configurationDefaults })`；机制侧只 boot 一次；
5. `EmbeddedWorkbench` 起 workbench 服务、`PracEditorHost`（`IEditorGroupsService`）、overlay/float host；
6. `PartHostFace` 发布；`pracVscode` service 发布；
7. consumers 注入 `pracVscode`；`ui-vscode-views` / `ui-vscode-editor` 读 catalogue 并注册 `prac.view`；
8. arrangement 落位；frame 渲染区域/stack；`hostFor(view)` 给宿主元素。

### 4.2 view

1. catalogue 增（`source: "view"` 或 `"file"`）；
2. consumer 注册 `prac.view`（id = `vscode:view:<id>` / `vscode:file:<placement>:<resource>`）；
3. frame 按 `location` / `containerId` 落成区域、具名子区域或 stack 行；
4. `hostFor(view)` 返回 mount 组件；
5. `vscode-embed` 的 view host → `mountViewInto(viewId, element)`；
6. `tryMountView` 取 descriptor，直接 `createInstance(ViewPane)`，`render()`、`setVisible(true)`，放进 `.monaco-pane-view`；
7. `focusView` / title action / container action 按 owner 分派；
8. catalogue 减或视图离场：`releaseView`、`removeView`、剪持久化位置。

当前第 6 步**没有 `ViewPaneContainer`**：`ViewPane` 是直接创建的。这是 container/view surface 的缺口，不是 frame 的缺口。

### 4.3 editor

1. catalogue 的 `source: "file"` 条目带 placement；
2. `ui-vscode-editor` 注册 `prac.view`；
3. `PracEditorHost` 的 group 绑到 frame 的区域；`addGroup` 走 `createRegionBeside` / `regionInDirection`；
4. `mountFileInto(placement, resource, element)`；group 用 `EditorGroupModel` / `EditorPanes`；
5. 同一个文件可以出现在多个 group / 区域，视图 id 用 placement 区分；
6. dispose：`releaseFile` / `removeRegion` / `removeView`。

### 4.4 overlay

1. `EmbeddedWorkbench` 自己的 root 住在 `shell.overlay` / `floatHost`；
2. 应用服务创建的 context view / quick pick / notifications / hover / dialog 进 float host；
3. view 部件自己画的补全/webview overlay 留在 view 盒内；
4. 次序由 `shell.overlay` 的 entry `order` 决定，不由 z-index 猜。

### 4.5 extension host / LSP

- P1 是另一条链：[2026-09-21-p1-ext-host-chain.md](../in-progress/2026-09-21-p1-ext-host-chain.md)；
- UI 的 `EmbeddedWorkbench` 有自己的扩展宿主；
- agent 侧的扩展宿主与 UI 侧分开；
- UI adaptor 只消费扩展贡献出来的 view / menu / command / webview / editor 面。

### 4.6 失败与顺序

- 没有 workspace：不 boot，等 registry；不猜测路径；
- boot 之前 catalogue 为空：consumer 等待 `pracVscode`，不要在启动期缓存空目录；
- `tryMountView` 找不到 descriptor：deferred，等 view 注册后再试；
- workbench 未启动：`tryMountView` 返回 false，不要创建半成品 pane；
- view 已注册但 frame 未落位：`hostFor` 不渲染，等 placement；
- code server / workbench 失败：adaptor 报错，frame 不接管 VS Code 的启动；
- 页面关闭：frame dispose → consumer dispose → `releaseView` / `releaseFile` → workbench dispose。

## 5. Surface ownership

| surface | VS Code 侧 | owner | step |
| --- | --- | --- | --- |
| **part / region** | titlebar / banner / activitybar / sidebar / editor / panel / auxiliarybar / statusbar；`Layout`/`Grid` | frame 负责布局；adaptor 负责 part 语义 | future part context |
| **view container / view** | `ViewContainer` / `ViewPaneContainer` / `ViewPane` / `ViewContainerModel` | adaptor | future container/view step（architecture 之后） |
| **action / menu** | `ViewTitle` / `ViewContainerTitle` / `commands` / `keybindings` / `menus` | adaptor 提供 action；frame 提供 slot | future action/menu context |
| **status bar / overlay** | status bar item；notifications / quick pick / input / dialog / context view / hover | adaptor 提供内容与容器；frame 提供 overlay 层 | future overlay/status context |
| **webview / custom editor** | webview view / panel；custom editor | adaptor | future webview/editor context |
| **编辑器内容 UI** | decorations / hover / CodeLens / Inlay Hints / semantic tokens | adaptor（编辑器链） | future editor content context |
| **专用视图** | SCM / comments / timeline / tests / debug / task / terminal / notebook / chat | adaptor；多数是 view + action，部分需要 controller | future specialized views |
| **主题 / 设置 / walkthrough** | themes / icon themes / configuration / walkthroughs | adaptor + frame 的主题/设置面 | future themes/settings |

这张表是 **ownership**，不是设计；每个 surface 的细节在自己的 step。

### 5.1 第一个 surface：container / view

当前事实：

- `tryMountView` 直接创建 `ViewPane`，没有 `ViewPaneContainer`；
- `IViewsService.getViewWithId` 返回 null；
- `Collapse Folders` 这类 container-scoped action 没有 owner；
- `view/title`、`view/item/context` 的 action 仍能挂在 view 上。

architecture 只定形状，不定机制：

- container context 应位于 **adaptor 内部**，在 `ViewPane` 与 `PracLayoutFace` 之间；
- 它要承接：view 集合、可见性、顺序、size、focus、container title / menu、`viewsWelcome`；
- 它不能把 part/pane composite 的 layout 带回 frame；
- 具体用 headless real `ViewPaneContainer` 还是更小的 context，是 architecture 之后的 step；
- 不沿用已 abandoned 的 container context note 的 B 结论。

## 6. Non-goals

- 不采用 VS Code 的布局；
- 不做完整 part / pane composite；
- 不让 VS Code 扩展直接碰 frame / workbench chrome；
- 不保留第二个离屏编辑器部件；
- 不把 frame 的 stack / grid 塞进 adaptor；
- 不往 DSH 加能力；
- 不让 frame 认识 VS Code 的 part / container / pane / editor group；
- 不把 container 的 owner 放回 frame。

## 7. Steps

- [view catalogue](../in-progress/2026-10-06-vscode-view-catalogue.md)（in-progress）；
- [editor host](../in-progress/2026-10-07-editor-host.md)（in-progress）；
- **container / view**：architecture 之后重新推导；不沿用被 superseded 的 container context note；
- **action / menu**；
- **status bar / overlay**；
- **webview / custom editor**；
- **editor content UI**；
- **专用视图**；
- **themes / settings / walkthroughs**。

frame 侧（stack chrome / grid）不属于这张 note 的 steps，见各自的 note。

## 8. Open questions

- **part context** 的最小契约：frame 的 `left` / `bottom` / `center` 与 VS Code 的 sidebar / panel / editor 如何对应，谁决定 part 的显示 / 尺寸 / 标题？
- **view container / view** 的机制：headless `ViewPaneContainer`，还是更小的 context？`IViewsService` 怎么注册？
- **action / menu** 的 owner：view-scoped / container-scoped / global 的边界由谁判定？
- **overlay**：adaptor 只给内容、frame 给层，是否足够？
- **webview / custom editor**：webview view、webview panel、custom editor 是否共用同一个 host 契约？
- **editor content UI**：属于 editor host，还是独立 context？
- **专用视图**：哪些必须有自己的 controller / action note？
- **themes / settings / walkthroughs**：是否只是内容面，不需要新的 owner？
- **boot**：`pracVscode` service 与 workspace / code server 的生命周期谁先谁后？
- **catalogue**：catalogue 是 adaptor 的唯一入口，还是允许 consumer 直接问 `IViewDescriptorService` / `IEditorService`？

## Related

- [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：总 umbrella。
- [docs/architecture.md](../../../docs/architecture.md) §2.2 / §3.1 / §3.2：prac 的目标架构与 view 是单位。
- [docs/concepts.md](../../../docs/concepts.md) 七：容器是具名子区域，不是 owner。
- [docs/vscode.md](../../../docs/vscode.md) §3：frame / part / container / pane / view。
- [docs/vscode.md](../../../docs/vscode.md) §4：扩展的 UI 能力范围。
- [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：视图隔离、区域骨架、视图是单位。
- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：view catalogue。
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：editor host。
- [2026-10-17-stack-view-chrome.md](../in-progress/2026-10-17-stack-view-chrome.md)：frame 侧的 stack chrome。
- [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)：frame 侧的 grid。
