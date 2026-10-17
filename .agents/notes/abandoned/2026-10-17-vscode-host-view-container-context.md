---
status: abandoned:superseded
---

# Agent Note: vscode-host 作为 adaptor —— view container context

> **Superseded**：本 note 先于 [vscode-host architecture](../in-progress/2026-10-17-vscode-host-architecture.md) 写成，把 collapse 的修法上升成 container context 并先选了 B。它的观察保留为证据；container/view 将作为 architecture 之后的 step 重新推导。
>
> **这是哪件工作**：prac 的 frame 按 view/region 组合；VS Code 的 view container/part 语义需要由 `vscode-host` 这个 adaptor 接住。umbrella 见 [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)。
> **状态**：已由 architecture 取代。

## Problem

`vscode-host` 是 prac 与 VS Code 之间的 **adaptor**。它现在把 VS Code 的 `ViewPane` 直接挂进 frame 的 host，但 **没有 container context**：

- view 的 surface、tree、title action 都工作；
- VS Code 里以 container 为 owner 的功能没有落点：
  - `IViewsService.getViewWithId(VIEW_ID)` 返回 `null`；
  - `Collapse Folders in Explorer` 执行了，但 `collapseAll()` 静默不跑；
  - container 级 menu/visibility/focus/命令同样没有承接。

这不是“frame 少了一个 owner”，也不是“把 container-scoped action 过滤掉”能解决的。`vscode-host` 是 adaptor，**它的职责就是把 VS Code 的 container/part 功能接住**，再以 prac 的 view/region 契约呈现。

## 设计立场

prac 的 frame 和 VS Code 的 adaptor 是两层，不要混：

| | 归属 | 单位 |
| --- | --- | --- |
| **frame** | prac | **view** 是唯一可显示单位；**区域**是唯一排布单位 |
| **vscode-host（adaptor）** | 承接 VS Code | `ViewContainer` / `ViewPaneContainer` / `ViewPane` / `part` 的语义 |

- frame 的 `container:<id>` 是**具名子区域**（视觉分组），不是 VS Code 的 owner；
- adaptor 内部可以、也应该有 VS Code 的 **container context**；
- frame 不认识 VS Code 的 container/part；
- adaptor 把 VS Code 的功能**翻译**成 prac 的 view/region + view action，而不是把 VS Code 的布局搬进 frame。

`docs/architecture.md` 的“view 是单位 / container 是具名子区域 / part 是可选高级形态”约束的是 **frame 的编排模型**；它不否定 adaptor 需要一个 container context 来承接 VS Code 的 container 功能。

## 扩展 UI 能力对 container context 的要求

VS Code 扩展的 UI 能力是一组封闭的 surface（见 [docs/vscode.md](../../../docs/vscode.md) §4）：`viewsContainers` / `views` / `viewsWelcome`、`view/title` / `view/item/context`、container title、status bar、notifications / quick pick / dialog、webview / custom editor、编辑器内容 UI、SCM / comments / timeline / tests / debug / task / terminal / notebook / chat、themes / settings / walkthroughs。

本 note 只处理其中的 **view container / view surface**：

- `viewsContainers` / `views` / `viewsWelcome`；
- `view/title` / `view/item/context`；
- container title / menu；
- view 的 order / visibility / focus / size；
- container 的 view 集合模型（`ViewContainerModel`）。

其余 surface（status bar、overlay、webview、编辑器内容、SCM / comments / timeline / …）由各自 adaptor 承接，不在这个 note 的 container context 里。

这组 surface 说明：container context 不能只是 `getViewWithId` 的补丁；它至少要能承接：

- view 的创建 / 移除 / 可见性 / 顺序 / 尺寸；
- container title/menu 与 view title/item menu 的 action owner；
- focus / visibility 的语义；
- `viewsWelcome` 与 view 的空状态。

## 当前结构

VS Code 原生：

```
ViewDescriptorService
  └─ ViewContainer（workbench.view.explorer）
       └─ ViewPaneContainer（owner）
            └─ ViewPane
```

embedded host：

```
ViewDescriptorService
  └─ ViewDescriptor
       └─ ViewPane（tryMountView 直接 createInstance）
            └─ .monaco-pane-view
                 └─ frame 的 IsolatedView host
```

prac：

```
left
  └─ container:workbench.view.explorer   ← 具名子区域（视觉）
       └─ stack
            ├─ row: Open Editors
            ├─ row: Folders
            ├─ row: Outline
            └─ row: Timeline
```

断点在 adaptor：它只创建了 `ViewPane`，没有建立 `ViewPaneContainer` 的承接层。

## 机制

### A. per-container adaptor（子集 / 过渡）

每个 VS Code container（`workbench.view.explorer` 等）在 `vscode-host` 内部对应一个 **container adaptor**：

- 由 `viewDescriptorService` 的 container descriptor 创建；
- 持有该 container 下 mounted `ViewPane` 集合；
- 向 workbench 注册一个最小的 `IViewPaneContainer`（或等价的 container context），使：
  - `IViewsService.getViewWithId(viewId)` 能返回 mounted view；
  - container-scoped command/action 能解析到 view；
  - `focus` / `visibility` / `onDidAddViews` / `onDidRemoveViews` 有落点；
- 把 container 的 title/menu/action 映射成 prac 可用的形态：
  - view 行头仍然是 view action；
  - container 条/容器菜单承接 container action；
  - action 的 owner 在 adaptor 里判定，不由 frame 猜。

frame 侧：

- `container:<id>` 仍是具名子区域；
- 它只告诉 adaptor “这个 container 在屏上了”；
- frame 不持有 `ViewPaneContainer`，也不参与 VS Code 的 owner 语义。

### B. headless real `ViewPaneContainer`（推荐）

如果最小 adaptor 接不住某些 container 功能（例如 container 的 view 集合模型、拖放、visibility），可以让 adaptor 创建一个 **headless 的真实 `ViewPaneContainer`**：

- 不挂 part/pane composite；
- 只作为 container context 和 view owner；
- frame 仍然给 view 盒子。

这是 A 的“更完整实现”，也是当前更接近 VS Code view container 语义的 target：`ViewPaneContainer` 本身已经承接了 view 集合、`ViewPane` 生命周期、title/menu、visibility/focus 的模型；headless 只是不挂 part/pane composite。A 只有在能实现同一组模型时才是它的子集。

### C. full part / pane composite

语义最完整，但会把 VS Code 的 part layout 和生命周期带回来，和 frame 的 view/region 编排冲突。不作为方向。

### D. scope / 过滤（过渡）

只把 container-scoped action 从 view 标题条过滤掉，或只走 view-scoped action。  
能临时消除错误，但**不承接 VS Code 的 container 功能**；作为过渡可以，作为终态不行。

## 推荐

- **B（headless real `ViewPaneContainer`）** 作为 view container surface 的 target；
- **A** 只有在能够承接同一组 view container 模型时才是 B 的子集，否则只是过渡；
- **C** 不取；**D** 只作为临时收口；
- 其他扩展 UI surface 不塞进这个 container context，分别由 status bar / overlay / webview / editor / SCM / comments / timeline / debug / task / terminal / notebook / chat 的 adaptor 承接。

## 责任边界

| 层 | 负责 |
| --- | --- |
| frame | 区域/stack/fold/sash/拖拽；给 view 盒子；不认识 VS Code container |
| vscode-host adaptor | `ViewContainer` / `ViewPaneContainer` / `ViewPane` 的生命周期；container context；命令/action/focus/visibility；把 VS Code 功能翻译成 prac 的 view/action |
| `ui-vscode-views` | 把 adaptor 提供的 view/action 注册成 `prac.view` / view header |
| 编排 | 把 `containerId` 落成具名子区域；不参与 VS Code owner |

关键点：**container 的 owner 在 adaptor 内部，不在 frame；frame 仍然只认 view/region。**

## 验收

- `IViewsService.getViewWithId(VIEW_ID)` 返回 mounted `ExplorerView`；
- `Collapse Folders` 真正执行，树收起；
- container-scoped action 与 view-scoped action 各有明确落点；
- view title action、container 条/容器菜单至少各验证一次；
- focus / visibility 不出现第二个权威；
- `verify:stack` 17/17、`verify:views` / `verify-focus` / `verify-layout` 保持；
- frame 的 fold/sash/drag 不退化。

## Open questions

- 最小 `IViewPaneContainer` 的注册点：`IViewsService.viewPaneContainers` 是私有的；是 subclass、service override，还是 adaptor 自己的 registry？
- container adaptor 的生命周期：跟随 `container:<id>` region 的创建/销毁，还是跟随 container descriptor？
- frame 的 `container:<id>` region 与 adaptor 的 container context 谁先创建、谁通知谁？
- view 的 title action 与 container 的 action 的边界：由 adaptor 的 action scope 判定，还是由 `MenuId`/`when` 判定？
- container 条/容器菜单是否复用 frame 的 container bar，还是 adaptor 提供内容、frame 只给位置？
- `focus` / `visibility`：`ViewPaneContainer` 本来的语义与 frame 的 stack/fold 如何不打架？
- 编辑器组（`PracEditorHost`）是否复用同一套 adaptor container context，还是保持两条链？
- DSH 自己的 view 分组有没有对应的 adaptor 概念，还是只有 VS Code 的 container 需要？

## Related

- [docs/architecture.md](../../../docs/architecture.md) §2.2 / §3.1 / §3.2：view 是单位；容器是具名子区域；part 是可选高级形态。
- [docs/concepts.md](../../../docs/concepts.md) 七：容器 = 区域的孩子；不是新对象。
- [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md) §3.2：容纳单位 = view；container/part 不是 prac 组合的单位。
- [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：容器 = 具名子区域；activity bar 不继承。
- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：容器本身不进目录；`containerId` 只是元数据。
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：编辑器组是另一条 owner 链。
- [docs/vscode.md](../../../docs/vscode.md) §3：frame / part / container / pane / view 的 UI 布局模型。
- [docs/vscode.md](../../../docs/vscode.md) §4：扩展的 UI 能力范围（声明式贡献 + 运行时 API + 边界）。
