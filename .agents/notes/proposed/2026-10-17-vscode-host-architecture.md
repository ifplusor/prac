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

## 3. 契约

### 已有

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

### 未来

- **view action / container action**：`ViewTitle` / `ViewContainerTitle` 的 owner 与 scope；
- **container context**：view container / view surface 的 runtime；
- **part context**：frame 的顶层区域 ↔ VS Code 的固定 part；
- **overlay context**：status bar / notifications / quick pick / dialog / context view / hover；
- **webview / custom editor context**；
- **editor content context**：decorations / hover / CodeLens / Inlay Hints。

这些契约未定；不要在 step 里先写成既成事实。

## 4. 生命周期

### boot / workbench

- `pracVscode` service 启动；
- 确定 workspace / code server / workbench 资源；
- 创建 workbench face；
- 注册 float host / part hosts / view hosts；
- 发布 catalogue；
- 订阅 catalogue 变化。

### view

1. catalogue 增；
2. consumer 注册 `prac.view`；
3. frame 按 `location` / `containerId` 落成区域 / 具名子区域 / stack 行；
4. `hostFor(view)` 给宿主元素；
5. adaptor 创建 / 挂载 `ViewPane`；
6. future：container context 承接 view 集合 / 可见性 / 顺序 / action / focus；
7. catalogue 减或视图离场：释放宿主，剪掉持久化位置 / 顺序 / 选中；
8. dispose。

### editor

1. catalogue 的 `source: "file"` 条目；
2. `ui-vscode-editor` 注册 `prac.view`；
3. `PracEditorHost` 的 group / region；
4. `EditorGroupModel` / `EditorPanes` / editor pane；
5. 编辑器组是平行链，不混进 container context；
6. dispose。

### overlay

- 由 workbench 的应用服务创建的 overlay（context view / quick pick / notifications / hover / dialog）进 frame 的 `shell.overlay` / float host；
- 由 view 部件自己画的 overlay（补全列表 / webview overlay）留在 view 自己的隔离盒子里；
- 这是 ownership 分界，不是 CSS 细节。

### extension host / LSP

- P1 是另一条链：[2026-09-21-p1-ext-host-chain.md](../in-progress/2026-09-21-p1-ext-host-chain.md)；
- 不经过 UI adaptor；
- UI adaptor 只消费扩展贡献出来的 view / menu / command / webview / editor 面。

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
