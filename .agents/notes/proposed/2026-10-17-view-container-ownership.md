---
status: proposed
---

# Agent Note: view title action 的 scope —— 容器不是 owner

> **这是哪件工作**：prac 的 frame 按 view 组合 VS Code 内容；VS Code 的 view title menu 里混着 view 级和 container 级 action，需要一层 scope 规则。umbrella 见 [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)。
> **状态**：提出，未裁。

## Problem

当前 frame 把 VS Code 的**单个 `ViewPane`** 挂进 region/stack；**`ViewPaneContainer` 这一层不存在**。

于是 view title menu（`MenuId.ViewTitle`）里那些**以 container 为 owner 的命令**会失效。`Collapse Folders in Explorer` 是最直接的例子：

```ts
const view = viewsService.getViewWithId(VIEW_ID); // null
if (view !== null) (view as ExplorerView).collapseAll();
```

命令执行了，但 `getViewWithId` 返回 `null`，`collapseAll()` 静默不跑。

但这不是“少了 `ViewPaneContainer`，要补一个 owner”。prac 已经裁决：

- **视图是唯一可显示的单位**；
- **区域是唯一的排布单位**；
- **容器 = 一个具名子区域**（视觉分组），不是新的 owner；
- **part 是可选的高级形态，不是组合的单位**；
- **现在是按视图组合就够**（`docs/architecture.md` §7 #6 仍是开放问题，不是已定的下一步）。

所以真正的问题不是“container ownership 缺失”，而是：

> **我们把 container-scoped action 当成 view action 暴露在 view 的标题条里。**

## 已有的设计约束

- **frame 不认识来源**：它只见 `prac.view` 注册表。
- **容器不越过编排**：机制只报 `containerId` / `containerTitle`；**编排**把它落成“选一的子区域（带名字）”。
- **activity bar 不继承**：切换的载体是区域头部的容器条。
- **不要让 VS Code 的布局主导 frame**（`docs/architecture.md` §2.2）。
- **view 是单位**：`dsh:*` 与 `vscode:*` 一视同仁；`editor` 也是一个文件一个 view，不是 editor group。

因此，`ViewPaneContainer` 不是“应该补上的层”，而是 **prac 当前明确不采用的 VS Code 高级形态**。

## 当前实现的事实

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
  └─ container:workbench.view.explorer   ← 具名子区域（视觉分组）
       └─ stack
            ├─ row: Open Editors
            ├─ row: Folders
            ├─ row: Outline
            └─ row: Timeline
```

- `ViewPane` 是 view 的 surface；
- `ViewPaneContainer` 是 VS Code 的 owner；
- prac 的 container 是**视觉分组**，不是 owner；
- `IViewsService.getViewWithId` 依赖 `ViewPaneContainer`，所以对 mounted view 返回 `null`。

这个 `null` 是**当前模型的必然结果**，不是漏了一层。

## 设计问题

**view title 条里，哪些 action 是 view-scoped，哪些是 container-scoped？**

`MenuId.ViewTitle` 在 VS Code 里把两类混在一起：

- view 自己的 action：New File、New Folder、Refresh、Filter、Pin、View as List…
- container/上下文 action：Collapse Folders、container menu、与 container 的 view 集合/可见性相关的命令。

prac 把 view 拿出来单独摆，**container 的 owner 语义没有跟过来**；所以：

- view 自己的 action 应该继续工作；
- container-scoped action 要么**不要出现在 view 标题条**，要么**由 prac 显式重实现为 view-scoped action**；
- 不能靠引入 `ViewPaneContainer` 让所有 container 命令“碰巧”工作。

## Proposal

### A. view-scoped action（推荐，当前架构）

保持 view 是单位，不改全局 `IViewsService`：

- `vscode-host` 维护 mounted `ViewPane`；
- view title action 由 host 用 mounted view 执行；
- collapse 这类“作用在 view 自身内容上”的动作，走 mounted `ExplorerView.collapseAll()`；
- 其他真正的 container/global 命令，不由 view 标题条代理。

这样 action 语义仍然落在 view 上，不引入 container owner。

### B. container-scoped command 的过滤/声明（推荐，补 A）

view 标题条只暴露 **view-scoped** action。需要一层 scope 声明，因为 `MenuId.ViewTitle` 本身不区分：

- 由 `ui-vscode-views`/host 给 action 标 `scope: "view" | "container" | "global"`；
- 或者维护一份“在 prac 的 view 条里不出现”的 container action 列表；
- container 级 action 留在 container 条/容器菜单，不进入 view 行头。

否则每个 container 命令都会以同样的方式坏掉。

### C. container host（未来高级形态）

如果将来真的采用 container/part 作为**可选高级形态**（`docs/architecture.md` §7 #6 的开放问题），再设计一个 headless container host：

- host 持有 mounted views，向 `IViewsService` 注册最小 `IViewPaneContainer`；
- frame 仍然管 layout；
- 这是一次**架构扩展**，不是 collapse 的修法。

### D. 真实 `ViewPaneContainer` / pane composite

语义最完整，但会把 part/container 的 layout 和生命周期带回来，和“view 是单位”冲突。不作为当前方向。

## 比较

| | view 是单位 | container owner | 当前 collapse | 成本 | 架构影响 |
| --- | --- | --- | --- | --- | --- |
| A view-scoped action | 保持 | 不需要 | 可修 | 低 | 小 |
| B 过滤/声明 scope | 保持 | 不需要 | 防同类 | 中 | 小 |
| C container host | 保持 frame | 引入 | 可修 | 中 | 大；要等 §7 #6 裁决 |
| D 真实 container/part | 冲突 | 引入 | 可修 | 高 | 大；不取 |

## 推荐

- **A + B**：view-scoped action 走 mounted view；container-scoped command 从 view 标题条过滤或显式声明。
- **C 只在 §7 #6 被裁决为“需要高级形态”后**再设计；不能因为一个 collapse 反向推动架构。
- **D 不取**。

## 验收

- `Collapse Folders` 通过 mounted `ExplorerView.collapseAll()` 生效；
- New File / New Folder / Refresh 等 view-scoped action 不受影响；
- view 标题条不再出现无法工作的 container-scoped action；
- `verify:stack` 17/17、`verify:views` / `verify-focus` / `verify-layout` 保持；
- frame 的 fold/sash/drag 不退化；
- 不引入 `ViewPaneContainer`，不改全局 `IViewsService.getViewWithId` 的语义。

## Open questions

- `MenuId.ViewTitle` 没有 scope 元数据；scope 由谁声明：`ui-vscode-views` 的映射、host 的 action 表，还是 action id 的命名约定？
- “Collapse Folders”到底算 view-scoped 还是 container-scoped？它作用于 view 的树，但 owner 是 container；这决定它是 A 还是 B。
- container 条/容器菜单将来要不要承接 container-scoped action？如果要，它属于“具名子区域”的装饰，不是 view 行头。
- `view` 的 action 集合会随 `when`/context 变化；scope 是否也要随 context 变？
- DSH 自己的 view 有没有 scope 概念？还是只有 VS Code 借来的 view 需要这层？
- 如果将来采用 container 高级形态，A/B 的 scope 层是否可以直接升级为 host 的 owner 语义？

## Related

- [docs/architecture.md](../../../docs/architecture.md) §2.2 / §3.1 / §3.2 / §7 #6：view 是单位；容器 = 具名子区域；part 是可选高级形态。
- [docs/concepts.md](../../../docs/concepts.md) 七：容器 = 区域的孩子；不是新对象。
- [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md) §3.2：容纳单位 = view；container/part 不是单位。
- [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：容器 = 具名子区域；activity bar 不继承。
- [2026-10-06-vscode-view-catalogue.md](../in-progress/2026-10-06-vscode-view-catalogue.md)：容器本身不进目录；`containerId` 只是元数据。
- [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md)：编辑器组是另一条 owner 链，不是 view container 的模板。
