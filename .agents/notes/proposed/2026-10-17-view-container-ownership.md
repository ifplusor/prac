---
status: proposed
---

# Agent Note: view container 的 ownership —— prac 的 container region 与 VS Code 的 ViewPaneContainer

> **这是哪件工作**：prac 的 frame 已经在任意 region/stack 里摆 VS Code 的单个 view；这一层没有 owner 的设计。umbrella 见 [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)。
> **状态**：提出，未裁。

## Problem

当前 embedded host 把 VS Code 的 **`ViewPane` 直接挂进 frame 的 view host**，因此 **`ViewPaneContainer` 这一层不存在**。

prac 的 `container:<id>` region 是**视觉 selector**：一个具名子区域，带容器条，在容器之间选一。VS Code 的 `ViewPaneContainer` 是**view 的所有者**：它创建/持有 view，管可见性、尺寸、focus、container 级 menu/action，并把自己注册进 `IViewsService`。

两者名字都叫 container，但**不是同一个东西**。

于是：

- view 的内容、tree、title action 都工作；
- 但依赖 owner 的 container 级服务和命令会拿不到 view，或走错上下文；
- `Collapse Folders in Explorer` 是最直接的例子：命令能执行，`viewsService.getViewWithId(VIEW_ID)` 却返回 `null`，`collapseAll()` 静默不跑。

这不是一个 command 的 bug，而是 **container 的 ownership 没有定义**。

## 当前实际结构

VS Code 原生：

```
ViewDescriptorService
  └─ ViewContainer（例如 workbench.view.explorer）
       └─ ViewPaneContainer（part 里真正拥有这些 view 的容器）
            └─ ViewPane（Open Editors / Folders / Outline / Timeline）
```

embedded host 实际：

```
ViewDescriptorService
  └─ ViewDescriptor
       └─ ViewPane（embeddedWorkbench.tryMountView 直接 createInstance）
            └─ .monaco-pane-view 包裹
                 └─ frame 的 IsolatedView host
```

`tryMountView` 的注释写的是 **“Mirrors `ViewPaneContainer.createView`”**：ctor、options、`setVisible(true)`、`.monaco-pane-view`、layout 都手动补了；缺的正是 `ViewPaneContainer` 本身。

prac frame 的 region：

```
left
  └─ container:workbench.view.explorer   ← 视觉 selector（prac 的 container）
       └─ stack
            ├─ row: Open Editors
            ├─ row: Folders
            ├─ row: Outline
            └─ row: Timeline
```

| prac | VS Code |
| --- | --- |
| `left` region | sidebar part（未真正挂载） |
| `container:<id>` | `ViewContainer` 的描述 + 视觉 selector |
| `stack` | 该 container 下的 `ViewPane` 集合 |
| 每个 stack row | 一个 `ViewPane` |
| `IsolatedView` | view host |
| **缺失** | **`ViewPaneContainer`** |

`IViewsService.getViewWithId` 不是从 active composite 取，而是：

```ts
const viewContainer = this.viewDescriptorService.getViewContainerByViewId(id);
const viewPaneContainer = this.viewPaneContainers.get(viewContainer.id);
return viewPaneContainer?.getView(id) ?? null;
```

`viewPaneContainers` 由 `ViewPaneContainer` 构造时注册；frame 不创建 container，所以 mounted view 对全局视图服务不可见。

## 为什么这不顺

1. **container 是名字，不是 owner**
   - prac 的 container region 管“显示哪个容器/哪个 view”；
   - VS Code 的 container 管“谁拥有这些 view”；
   - 当前只有前者，后者被 `tryMountView` 旁路了。

2. **全局服务与 per-view 挂载不一致**
   - `getViewWithId` / `getActiveViewPaneContainerWithId` / container-scoped command 都假设 owner 存在；
   - mounted view 只在 frame 的 `mountedViews` 里；
   - 于是“view 自己能做的事”正常，“container 代表 view 做的事”失效。

3. **两个权威**
   - frame 管 layout / stack / fold / sash；
   - `ViewPaneContainer` 本来也管 view 的可见性、尺寸、focus；
   - 当前 frame 手动 `setVisible` / `layout`，等于用 per-view 挂载模拟 owner，但没有把它建模。

4. **container 级能力缺失**
   - container title / menu、view visibility、拖放、container action、focus 语义；
   - 单 view 的 title action 还能工作，但 container 级的会缺。

5. **命名碰撞**
   - `container` 在 prac 和 VS Code 里是两个概念；
   - 讨论里很容易把“视觉容器”当成“view owner”，collapse 就是这个词义混淆的症状。

## 设计问题

**prac 的 container region 是否应该成为 VS Code container 的 owner？**

具体是：

- container region 只负责“选哪个容器/哪个 view”，view 的 owner 交给一个 headless container host？
- 还是 container region 本身就是 owner，stack 是它内部的 view 排布？
- 还是保持 per-view 挂载，明确不提供 container 级服务，只补 view-scoped action？

## Proposal

### A. container host（推荐作为长期方向）

每个 prac 的 `container:<id>` region 对应一个 **headless container host**，由 `vscode-host` 创建并持有：

- host 从 `ViewDescriptorService` 拿 container 的 view descriptors；
- view 的创建走 host 的 `createView`（把 `tryMountView` 的逻辑收进来）；
- host 持有 mounted `ViewPane` 集合，并向 `IViewsService` 注册一个最小的 `IViewPaneContainer`（`getView` / `views` / `onDidAddViews` / `onDidRemoveViews` / `focus` / `getActionsContext` / `toggleViewVisibility`）；
- frame 仍然管 region / stack / fold / sash / 拖拽；
- host 管 view 的 owner 语义：create、visible、size、focus、container menu/action。

关键边界：

- **host 不挂 pane composite / part**，只拥有 view；
- **frame 不碰 view 内部**，只给 host 盒子；
- **container 的可见性/顺序**：frame 的 stack 是排布，host 的 view 集合是成员；两者需要明确谁写、谁读；
- **editor groups 不在这条链上**：编辑器由 `PracEditorHost` 走另一条 owner 路径。

### B. per-view 挂载 + view-scoped action（过渡）

保持当前 per-view mount，不改全局 `IViewsService`：

- `vscode-host` 维护 mounted `ViewPane`；
- view title action 由 host 用 mounted view 执行；
- container-scoped command 明确不支持，或逐个补 adapter。

代价：container 级能力仍然缺；collapse 能修，但下一个 container 命令还会遇到同样的洞。

### C. 真实 `ViewPaneContainer` / pane composite

语义最正确，但把 part/container 的 layout 和生命周期也带进来：

- 和 frame 的 per-view stack 抢布局；
- 为了 owner 重建整个 part，成本高；
- 不作为当前方向。

### D. container region 即 owner

把 prac 的 `container` region 直接升级为 owner：

- region 的 backing object 就是 host；
- stack 是 host 的 view 排布；
- 概念上最一致，但需要 frame 的 region 模型接受一个“外部 owner”对象，和 A 是同一件事的两种落法。

## 比较

| | ownership | frame layout | VS Code container 服务 | 成本 | 风险 |
| --- | --- | --- | --- | --- | --- |
| A container host | 完整 | 保留 | 可恢复 | 中 | 需要最小 `IViewPaneContainer` 注册 |
| B per-view + action | 部分 | 保留 | 缺失 | 低 | container 命令逐个漏 |
| C 真实 container/part | 完整 | 冲突 | 完整 | 高 | 与 frame 抢布局 |
| D region 即 owner | 完整 | 保留 | 可恢复 | 中 | 需要 region 模型支持 owner |

## 推荐

- **长期：A / D**。container region 和 VS Code container 应该是同一个 ownership 边界；stack 只是它的 view 排布。
- **短期：B**，只修当前 view-scoped 的 collapse，不动全局 `getViewWithId`。
- **不取：C**——为了 owner 重建 part，会把 layout 权威搞成两个。
- **不取**：把 mounted view 塞进全局 `getViewWithId`；那会让所有调用者拿到一个没有 container 的 view，污染面更大。

## 验收

- `IViewsService.getViewWithId(VIEW_ID)` 返回 mounted `ExplorerView`；
- collapse 真正执行，树收起；
- view title actions、container title/menu、focus、visibility 至少各有一次 live 验证；
- `verify:stack` 17/17、`verify:views` / `verify-focus` / `verify-layout` 保持；
- frame 的 fold/sash/drag 不因 host 引入而退化。

## Open questions

- `ViewPaneContainer` 是具体类，`IViewsService.viewPaneContainers` 是私有的；最小注册点放在哪里？需要 subclass、还是另开一个 `IViewPaneContainer` 注册缝？
- frame 的 stack 顺序/折叠与 host 的 view 集合，谁是权威？折叠是 frame 的 B4/D1，view 的显示/隐藏是 container 的；两张状态表如何不打架？
- container 的可见性/尺寸/focus：host 是否需要接管 `ViewPane.setVisible` / `layout`，还是继续由 frame 驱动？
- container 级 menu/action（title/menu）要不要一起接？
- `prac.view` 目录里的 `containerId` 只是元数据；host 建立后，它是否要升级为“container host 的 key”？
- 编辑器组（`PracEditorHost`）与 view container host 是否共用 ownership 抽象，还是保持两条链？
- DSH 自己的 view container（如果将来有）是否也要 host，还是只有 VS Code 的容器需要？

## Related

- [视图的隔离与对等 —— 区域骨架、视图是单位](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：container = 具名子区域；视图是单位。
- [VS Code 的视图进 prac 的视图目录](../in-progress/2026-10-06-vscode-view-catalogue.md)：容器本身不进目录，`containerId` 只是分组元数据。
- [prac 自己的编辑器宿主](../in-progress/2026-10-07-editor-host.md)：编辑器 group 的 ownership，是另一条链。
- [VS Code × DSH 集成](../in-progress/2026-09-09-vscode-dsh-integration.md)：umbrella。
