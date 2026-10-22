---
status: in-progress
---

# Agent Note: vscode-host 的架构 —— adaptor 的层、对象、契约与 surface

> **这是哪件工作**：prac 的 VS Code 面需要一个 adaptor；这张 note 是 adaptor 的 **sub-umbrella**，定义它的职责边界、层、对象、契约、生命周期、non-goals 与 surface ownership。总 umbrella 见 [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)。
> **状态**：已接受为方向（in-progress）。先按这张骨架走；每个 surface 的具体设计留给 step。
> **读法**：1–2 边界与结构；3–4 接口与生命周期；5–7 面、约束与计划；8 开放问题。

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
- frame 侧（区域、stack、fold、sash、grid）另有一条线，见 [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)、[2026-10-15-ui-layout-stack.md](../resolved/2026-10-15-ui-layout-stack.md)、[2026-10-17-stack-view-chrome.md](../in-progress/2026-10-17-stack-view-chrome.md)、[2026-10-15-ui-layout-grid.md](../proposed/2026-10-15-ui-layout-grid.md)；
- 这里不设计每个 surface；只定骨架与 surface ownership；
- 这里不替代总 umbrella；它是总 umbrella 下的一个 sub-umbrella。

## 1. 职责边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| **frame** | 布局拓扑 / region / view group / stack / fold / sash / 拖拽；container bar / group bar；给 view 盒子 | VS Code 的 part / container / pane / view 语义；扩展 UI 的内容 |
| **vscode-host（adaptor）** | VS Code 的 part / container / pane / view / action / overlay / webview / editor 语义；container context；catalogue；face；生命周期 | prac 的布局；container 成员；DSH 的运行时；frame 内部 |
| **vendor/vscode-embed** | 机制：boot、资产、宿主元素、命令面、bridge | 政策：哪个 workspace、哪些 view、怎么摆 |
| **vendor/vscode** | 上游 workbench（pin + patch + overlay） | prac 的词与政策 |
| **DSH** | shell、运行时、槽、服务、session | VS Code 的 UI |
| **consumers** | `ui-vscode-views` / `ui-vscode-editor` / arrangement | adaptor 内部 |

关键句：

> **frame 不认识 VS Code；adaptor 不持有 / 修改 frame 的内部布局状态，只通过 `PracLayoutFace`（`ctx.pracLayout`）、`prac.view`、host element 这些窄契约协作；container 的成员由 prac placement 决定，adaptor 只承接 VS Code container 语义；vendor 不认识 prac 的政策。**
>
> **group 是 frame 的；adaptor 不拥有 `GroupHost`。** adaptor 只把一个 `VscodeGroupBinding` 绑定到 frame 的 group 上，binding 内部才有 `ViewPaneContainer` / `EditorGroupBinding` / `IViewsService` 注册。

### 1.1 core workbench 与 extension

- **core workbench** 是 adaptor 内部的 **host / engine**：固定 part、container context、editor runtime、overlay、workbench 服务；它可以直接用 `IViewsService` / `IEditorGroupsService` / `IContextViewService`。
- **built-in extension / external extension** 是 **contributor**：只用 `vscode.*` 与 `contributes`；没有 DOM、没有内部服务；不能新增 part。
- adaptor 在 **ownership / capability** 上区别对待：core 拥有 host，extension 只能贡献。
- adaptor 在 **catalogue / `prac.view` / `hostFor` / action** 上不区别：core view 与 extension view 走同一套 view 契约。
- **container context 是 adaptor-owned runtime，不是成员权威**：它服务同一 container 里的 core view 与 extension view；container 本身是 prac 的具名 view group（默认 stack），成员由 placement 派生。

## 2. 层、对象与状态

```text
DSH shell / slots / services
  └─ prac-web-app + ui-layout（frame）
       ├─ ui-vscode-views（consumer：view entries）
       ├─ ui-vscode-editor（consumer：file entries）
       └─ vscode-host（adaptor）
            ├─ catalogue / face / host
            ├─ view group / container context（step）
            ├─ editor host（step）
            └─ vendor/vscode-embed（mechanism）
                 └─ vendor/vscode（upstream）
```

- **`vendor/vscode`**：上游源码 + patch + overlay；不出现 prac 词。
- **`vendor/vscode-embed`**：prac-free 的 wrapper lib；只给机制，不背政策。
- **`vscode-host`**：adaptor/policy；把 VS Code 的 UI 语义翻成 prac 可用的 catalogue / face / view host / editor host / overlay / action。
- **consumers**：按 DSH 的形式消费 face / catalogue；不碰 adaptor 内部。
- **frame**：只接收 `prac.view`、view group / placement 和 view 盒子；画 container bar / group bar；不认 part/container/pane。

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
- 在 boot 之前用 `ctx.pracLayout` 装好 **view group / cell channel**（现名 `setGroupRegionChannel`）：编辑器组的 `addGroup` 要同步建 **grid cell / select view group**，而不是只建 region；region 只是几何槽位；
- **workspace 是 window identity**：只有 `ctx.workspaces` + `ctx.uiSession` 能确定当前 workspace 时才 `embed.boot({ workspacePath, configurationDefaults: { "files.autoSave": "off" } })`；一个页面只 boot 一次；
- `ctx.provide("pracVscode", face)`；`shell.overlay` 注册 `embed.floatHost()`（`order: -100`，prac 自己的 overlay 在上）；
- consumers 通过 `inject: ["pracVscode"]` 等这个 service；frame 通过 `ctx.pracLayout` 提供区域/放置。

### 2.2 核心对象模型

按边界分三组：

#### 2.2.1 consumer 面

| 对象 | 作用 | 谁调用 | 不知道 |
| --- | --- | --- | --- |
| `PracVscodeFace` | consumers 的 adaptor 前台：catalogue / `hostFor` / `focusView` / `runCommand` / file placement / capabilities | consumers、诊断/门 | frame 的 layout |
| `VscodeCatalogueEntry` | catalogue 的一行数据：`view` / `appId` / `title` / `source` / `role` / `containerId` / `containerTitle` / `viewGroupId?`（`location?` 只作来源提示） | `ui-vscode-views` / `ui-vscode-editor` / arrangement | 怎么渲染 |
| `prac.view` | frame 的 view 注册槽：每个 view 的一次注册（id / label / icon / `paneHeader` / 宿主组件） | consumers | view 的来源 |

#### 2.2.2 embed / workbench

| 对象 | 作用 | 谁调用 | 不知道 |
| --- | --- | --- | --- |
| `VscodeEmbedHandle` | DSH 插件 boot / 挂载 workbench 的把手：boot / `view` / `file` / `placements` / `views` / `floatHost` / group region channel | `vscode-host` | frame 的 `LayoutState` |
| `WorkbenchFace`（目标名） | workbench 对 embedder 的内部面：view / file mount、focus / release、placements、capabilities；**不承载 part mount** | `vscode-embed` | consumers / `PracVscodeFace` |
| `EmbeddedWorkbench` | VS Code workbench 本体：workbench 服务、`IWorkbenchLayoutService`、view / editor host、overlay | `WorkbenchFace` | frame / consumers |
| `PracEditorHost` | adaptor 侧 editor runtime 的 owner：`IEditorGroupsService`、select view group / grid cell、editor group model / panes | workbench、`vscode-host` 的 group channel | prac 的 editor group 类型 / container |
| `VscodeGroupBinding` | 把 frame 的一个 view group 接到 VS Code runtime：`container` / `editor` / `unbound` 三种 mode；拥有 ViewPane / EditorPane host、container context、actions；注册 `IViewsService` | workbench、frame 的 GroupHost | group state / placement |
| `PracViewsService` | `IViewsService` 的 subclass / patch：维护 external view registry；binding 注册 / 注销 ViewPane；其余方法 delegate | workbench、`VscodeGroupBinding` | group state / placement |
| `ViewPane` | 一个 view 的 UI（上游 `ViewPane`） | `tryMountView` | frame |
| `ViewPaneContainer` | 一个 container 的 VS Code 运行时表示（上游）；不是成员权威 | container context | frame / prac 的 container 成员 |

#### 2.2.3 frame 契约

| 对象 | 作用 | 谁调用 | 不知道 |
| --- | --- | --- | --- |
| `PracLayoutFace` | frame 的布局服务：布局拓扑、view group、placement、grid cell、尺寸 | adaptor、arrangement、editor host | VS Code 的 part / container |

**`GroupHost` 在 frame 侧，不在这张 note 的对象表里。** frame 的 group / host 生命周期归 frame；adaptor 只通过 `VscodeGroupBinding` 挂上去。`VscodeGroupBinding` 不存在时，group 仍然是合法的 plain group（只放 DSH view）。

调用关系：

```text
boot:
  vscode-host.apply
    → createVscodeEmbed
      → VscodeEmbedHandle.boot
        → EmbeddedWorkbench
          → WorkbenchFace
        → PracEditorHost
        → floatHost → shell.overlay

view:
  PracVscodeFace.catalogue
    → consumer
      → prac.view
        → frame place
          → hostFor(view)
            → VscodeEmbedHandle.view
              → WorkbenchFace.mountViewInto
                → ViewPane

editor:
  VscodeEmbedHandle.file
    → WorkbenchFace.mountFileInto
      → PracEditorHost
        → frame region
```

### 2.3 状态归属

| 状态 | 归谁 |
| --- | --- |
| workspace / session identity | DSH |
| 布局拓扑、view group、placement、container 成员、stack/tab/fold/sash、持久化 | frame（`ui-layout`） |
| `ContainerRecord` / container 元数据 | prac |
| workbench、`ViewPaneContainer` / container context、editor group runtime、`VscodeGroupBinding`、`IViewsService` external registry、overlay | adaptor（`vscode-host` / workbench） |
| view catalogue（文件 + 视图） | adaptor（来自 `IEditorService` / `IViewDescriptorService`） |
| `prac.view` 注册 | consumers |
| capabilities（editors / diagnostics） | adaptor 计算；consumers 只读 |

关键：**frame 不持有 workbench 状态；adaptor 不持有 layout 状态，也不拥有 container 成员**。两边通过 `PracLayoutFace`、`prac.view`、host element 协作；container 成员由 placement 派生，container context 只是 VS Code 语义的运行时承接。

## 3. 契约

### 3.1 已有契约

| 面 | 形状 |
| --- | --- |
| `VscodeEmbedHandle` | `boot(launch)` / `view(viewId)` / `file(placement, resource)` / `placements()` / `views()` / `floatHost()` / `setViewGroupChannel(channel)`（现名 `setGroupRegionChannel`） / `focusView` / `runCommand` |
| `WorkbenchFace`（目标） | `mountViewInto` / `focusView` / `releaseView` / `mountFileInto` / `focusFile` / `releaseFile` / `listViews` / `listPlacements` / capabilities；**不暴露 part mount**（已移除） |
| `VscodeGroupBinding` | `mode: container \| editor \| unbound`；mount / release `ViewPane` / `EditorPane`；提供 container / group actions / context；调用 `PracViewsService.registerExternalView` |
| `PracVscodeFace` | `catalogue()` / `onDidChangeCatalogue()` / `hostFor(view)` / `focusView(view)` / `runCommand(command, ...args)` / `filePlacement(view)` / `fileResource(view)` / `capabilities.editors` / `capabilities.diagnostics` |
| `VscodeCatalogueEntry` | `view` / `appId` / `title` / `source: "file" \| "view"` / `role: "stage" \| "primary-sidebar" \| "secondary-sidebar" \| "panel"` / `containerId?` / `containerTitle?` / `viewGroupId?` |
| `PracLayoutFace` | `getState` / `subscribe` / `listViews` / `listViewGroups` / `place`（目标 `viewGroupId`）/ `placeQuietly` / `removeView` / `ensureViewGroup` / `moveViewGroup` / grid cell 操作 |
| `prac.view` | `{ name: "prac.view", id, label, icon, paneHeader? }` |

`WorkbenchFace` 现在只承担 view / file / capability face；part mount 是旧组合模型的残留，不在目标契约里。

### 3.2 未来契约

- **view action / container action**：`ViewTitle` / `ViewContainerTitle` 的 owner 与 scope；G：container 的 actions / context keys 归当前 container；
- **container context**：view container / view surface 的 runtime；见 [container context step](../proposed/2026-10-22-vscode-container-context.md)；
- **part context**：frame 的顶层区域 ↔ VS Code 的固定 part；
- **overlay context**：status bar / notifications / quick pick / dialog / context view / hover；
- **webview / custom editor context**；
- **editor content context**：decorations / hover / CodeLens / Inlay Hints。

这些契约未定；不要在 step 里先写成既成事实。

## 4. 生命周期与序列

### 4.1 boot / workbench

1. DSH 加载 `prac-client-vscode-host`；`apply()` 创建 `VscodeEmbedHandle`；
2. **view group / cell channel**（现名 `setGroupRegionChannel`）绑定 `ctx.pracLayout`；
3. 等 `ctx.workspaces` + `ctx.uiSession` 给出当前 workspace；
4. `embed.boot({ workspacePath, configurationDefaults })`；机制侧只 boot 一次；
5. `EmbeddedWorkbench` 起 workbench 服务、`PracEditorHost`（`IEditorGroupsService`）、overlay/float host；
6. `WorkbenchFace`（workbench → embedder 的 view/file/capability face）发布；`pracVscode` service 发布；
7. consumers 注入 `pracVscode`；`ui-vscode-views` / `ui-vscode-editor` 读 catalogue 并注册 `prac.view`；
8. arrangement 落位；frame 渲染区域/stack；`hostFor(view)` 给宿主元素。

### 4.2 view

1. catalogue 增（`source: "view"` 或 `"file"`）；
2. consumer 注册 `prac.view`（id = `vscode:view:<id>` / `vscode:file:<placement>:<resource>`）；
3. frame 按 `role` / `ContainerDeclaration` 的默认提示 + placement 落成 view group（container / stack / select）；region 只是几何槽位；
4. `hostFor(view)` 返回 mount 组件；
5. `vscode-embed` 的 view host → `mountViewInto(viewId, element)`；
6. 当前最小实现：`tryMountView` 取 descriptor，直接 `createInstance(ViewPane)`，`render()`、`setVisible(true)`，放进 `.monaco-pane-view`，并注册到 `PracViewsService`；这还不是 container context；
7. 目标：`VscodeGroupBinding` 负责 mount / release，并调用 `PracViewsService.registerExternalView` / `unregisterExternalView`；`focusView` / title action / container action 通过 `PracViewsService.getViewWithId` 找到 mounted pane；
8. 如果 group 没有 VS Code container（unbound），binding 仍然注册 external view；container 级方法返回 `null` / 不可用，view 自己的 actions / `viewsWelcome` 继续；
9. catalogue 减或视图离场：`releaseView`、`removeView`、剪持久化位置；binding 注销 external view。

当前第 6 步**没有 `ViewPaneContainer`**：`ViewPane` 是直接创建的。container context 目前是最小实现：

- `PracViewsService` 只让 `getViewWithId` / focus 找到 mounted pane；
- view 集合 / 可见性 / 顺序 / size / container title / menu / `viewsWelcome` 仍缺；
- 所以 `Collapse Folders` 已经能跑，但还不是完整 container。

### 4.3 editor

1. catalogue 的 `source: "file"` 条目带 placement；
2. `ui-vscode-editor` 注册 `prac.view`；
3. `PracEditorHost` 的 group 绑到 frame 的 **select view group / grid cell**；`addGroup` 走 group / cell channel，不是只建 region；editor group = select view group + adaptor binding；
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
| **part / region** | titlebar / banner / activitybar / primary sidebar / secondary sidebar / panel / statusbar；`Layout`/`Grid` | frame 负责布局与 role；adaptor 负责 part 语义 | future part context |
| **view container / view** | `ViewContainer` / `ViewPaneContainer` / `ViewPane` / `ViewContainerModel` | adaptor 承接 VS Code container 语义；成员归 prac placement；frame 画 container bar / group bar | [container context step](../proposed/2026-10-22-vscode-container-context.md) |
| **action / menu** | `ViewTitle` / `ViewContainerTitle` / `commands` / `keybindings` / `menus` | adaptor 提供 action / context；frame 提供 container bar / group bar slot | future action/menu context |
| **status bar / overlay** | status bar item；notifications / quick pick / input / dialog / context view / hover | adaptor 提供内容；frame 提供 frame-hosted overlay layer；source-managed behavior | future overlay/status context |
| **webview / custom editor** | webview view / panel；custom editor | adaptor | future webview/editor context |
| **编辑器内容 UI** | decorations / hover / CodeLens / Inlay Hints / semantic tokens | adaptor（编辑器链） | future editor content context |
| **专用视图** | SCM / comments / timeline / tests / debug / task / terminal / notebook / chat | adaptor；多数是 view + action，部分需要 controller | future specialized views |
| **主题 / 设置 / walkthrough** | themes / icon themes / configuration / walkthroughs | adaptor + frame 的主题/设置面 | future themes/settings |

这张表是 **ownership**，不是设计；每个 surface 的细节在自己的 step。owner 列里的 “adaptor” 指 core workbench / adaptor 侧；view / action 的入口对 core 与 extension 一视同仁。

### 5.1 第一个 surface：container / view

当前事实：

- `tryMountView` 直接创建 `ViewPane`，没有 `ViewPaneContainer`；
- `PracViewsService` 让 mounted pane 可按 id 解析；`Collapse Folders` 已验证可用；
- 但 view 集合 / 可见性 / 顺序 / size / container title / menu / `viewsWelcome` 仍缺；
- `view/title`、`view/item/context` 的 action 仍能挂在 view 上。

architecture 只定形状，不定机制：

- **group 是 frame 的**：`GroupHost` / group state / active / order 都在 frame；adaptor 不拥有 group；
- **`VscodeGroupBinding` 是 adaptor 侧的绑定**：mode 为 `container` / `editor` / `unbound`；没有 binding 的 group 仍然合法（plain group）；
- **container 是 prac 的具名 view group，默认 stack**；成员由 placement 派生，不是 adaptor 的成员表；
- container context 应位于 **adaptor 内部**，围绕 `ViewPane` / `ViewPaneContainer`；它通过 `PracLayoutFace` 和 frame 的 view host 协作，不拥有 layout；
- 它要承接：view 集合、可见性、顺序、size、focus、container title / menu、`viewsWelcome`、G 的 container actions / context keys；
- `ViewPane` 的 mount / release 由 binding 负责，并注册到 `PracViewsService` 的 external view registry；`getViewWithId` / `getActiveViewWithId` / `isViewVisible` 优先查这个 registry；
- unbound group 仍然能承载 `ViewPane`：只有 view 级 actions / welcome，没有 source container 的 actions / context keys；
- container context 是 **adaptor-owned runtime，不是成员权威**；它服务同一 container 里的 core view 与 extension view；
- **frame 画 container bar / group bar**；adaptor 提供 action / context，不能自己画第二套 bar；
- `ViewPane` 的 source container 上下文（title / icon / `viewLocation` / `ViewContainerTitle`）在 view 移出原 container 后必须覆盖或抑制，否则 G 不成立；
- `prac.view` 的 `paneHeader` 是 view 自报的呈现事实；frame 用它决定是否保留 native pane header，不按 `vscode:` 前缀猜；
- 它不能把 part/pane composite 的 layout 带回 frame；
- 具体用 headless real `ViewPaneContainer` 还是更小的 context，是 [container context step](../proposed/2026-10-22-vscode-container-context.md) 要定的机制；
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
- 不暴露 part host，也不把整块 VS Code part 当兜底；prac 只组合 view、editor placement、overlay。
- 如果将来要“part 作为高级形态”，另立设计；不保留一个现在就在的 fallback。
- 不按 core / extension 分 view 渲染路径；core view 与 extension view 走同一套 `prac.view` / `hostFor` / action。
- 不把 core workbench 当普通 extension 重建；core 是 host，extension 是 contributor。

## 7. Steps

- [view catalogue](../in-progress/2026-10-06-vscode-view-catalogue.md)（in-progress）；
- [editor host](../in-progress/2026-10-07-editor-host.md)（in-progress）；
- **container / view**：first pass（`PracViewsService` + collapse）已验证；剩余是 view 集合 / 可见性 / 顺序 / container title / menu；[container context](../proposed/2026-10-22-vscode-container-context.md) 已开 step note；
- **action / menu**；
- **status bar / overlay**；
- **webview / custom editor**；
- **editor content UI**；
- **专用视图**；
- **themes / settings / walkthroughs**。

frame 侧（stack chrome / grid）不属于这张 note 的 steps，见各自的 note。

## 8. Open questions

- **part context** 的最小契约：frame 的 role（`stage` / `primary sidebar` / `secondary sidebar` / `panel`）与 VS Code 的 part 如何对应，谁决定 part 的显示 / 尺寸 / 标题？left / center / right / bottom 只是默认物理位置。
- **view container / view** 的机制：见 [container context step](../proposed/2026-10-22-vscode-container-context.md)；headless `ViewPaneContainer`，还是更小的 context？
- **`IViewsService` external registry**：subclass 还是 patch `ViewsService`；`getActiveViewWithId` / container 级方法在 unbound group 下如何返回；谁负责 `focusedViewContextKey`。
- **action / menu** 的 owner：view-scoped / container-scoped / global 的边界由谁判定？container bar / group bar 由 frame 画时，action / context 怎么从 adaptor 供？
- **overlay**：frame-hosted、source-managed 是否足够；frame-managed `pracOverlay` 何时需要？
- **webview / custom editor**：webview view、webview panel、custom editor 是否共用同一个 host 契约？
- **editor content UI**：属于 editor host，还是独立 context？
- **专用视图**：哪些必须有自己的 controller / action note？
- **themes / settings / walkthroughs**：是否只是内容面，不需要新的 owner？
- **boot**：`pracVscode` service 与 workspace / code server 的生命周期谁先谁后？
- **catalogue**：catalogue 是 adaptor 的唯一入口，还是允许 consumer 直接问 `IViewDescriptorService` / `IEditorService`？

## Related

- [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：总 umbrella。
- [docs/architecture.md](../../../docs/architecture.md) §2.2 / §3.1 / §3.2：prac 的目标架构与 view 是单位。
- [docs/concepts.md](../../../docs/concepts.md) 七：容器是具名 view group，不是 owner。
- [2026-10-20-ui-framework.md](../in-progress/2026-10-20-ui-framework.md)：UI umbrella；container / view group / placement / G。
- [docs/vscode.md](../../../docs/vscode.md) §3：frame / part / container / pane / view。
- [docs/vscode.md](../../../docs/vscode.md) §4：扩展的 UI 能力范围。
- [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：视图隔离、区域骨架、视图是单位。
- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：view catalogue。
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：editor host。
- [2026-10-17-stack-view-chrome.md](../in-progress/2026-10-17-stack-view-chrome.md)：frame 侧的 stack chrome。
- [2026-10-22-vscode-container-context.md](../proposed/2026-10-22-vscode-container-context.md)：container context step。
- [2026-10-15-ui-layout-grid.md](../proposed/2026-10-15-ui-layout-grid.md)：frame 侧的 grid。
