---
status: in-progress
---

# Agent Note: VS Code 的视图进 prac 的视图目录

> **这是哪件工作**：`docs/architecture.md` §3.2（"扩展贡献的视图也按视图进来"）落到实现的一步；umbrella 见 [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)。
> **状态**：挂载模型、枚举层、目录形状、上屏策略已裁（James 2026-10-06）；工作在进行中。

## Problem

prac 的侧栏 view **写死**到一个 VS Code 视图：`packages/client/vscode-host` 的 `VSCODE_VIEW_OF_SEAT = { 'vscode:sidebar': 'workbench.explorer.fileView' }`。于是**扩展贡献的视图从不出现**（cSpell 的 `cSpellIssuesViewByFile`、webview 视图、探针那些）——缺的不是挂载能力（face 的 `mountViewInto` 已经会等未注册的视图并重试），而是**枚举**。

## 设计

### 借来的东西：一份目录，两类来源

**prac 的 frame 只面向一份目录**（`prac.view` 的注册表）。机制把借来的内容**镜像**成这份目录的条目——**条目会来去**：静态注册的由注册者控制，编辑器那种随上游集合（打开的文件）进出。frame 不关心来去，它只面对目录。

条目**只有一种形状**，差别只在来源标签与挂载函数：

| 属性 | 取值 |
| --- | --- |
| `view` | `vscode:file:<resource>` / `vscode:view:<viewId>`（id 约定归机制） |
| `title` | 显示名 |
| `source` | `file`（打开的文件） / `view`（容器里的视图） |
| `location` | 默认落位提示：`stage` / `sidebar` / `panel` / `auxiliarybar` |
| `containerId` / `containerTitle` | 视图条目才有（容器的分组元数据） |

- **枚举哪一层：`activeViewDescriptors`**。上游把容器里的视图分三层：`all`（注册集）、`active`（`when` 成立集）、`visible`（`active` ∧ 用户没隐藏——**容器实际排布的那批**）。prac 的 frame 扮演的就是上游容器"排布"的角色 ⇒ 注册的是 **`active`**；`when` 一变就进出目录（模型自己订阅 context key）。**不搬 `visible`**——否则 VS Code 的显隐会成为第二个"在屏上"的真相源。
- **"编辑器"与"视图"在 prac 这边是同一种东西**：都是 `prac.view`，frame 一视同仁。差别只有上面那张表的 `source` 与挂载函数（`mountFileInto` / `mountViewInto`）；**上游的语义**（打开 / 脏 / 当前 vs 容器 / `when`）**不假装统一**，它作为条目的元数据与 capability 保留。
- **容器本身不进目录**；`containerId` / `containerTitle` 只作分组元数据。

### 自动注册 + 自动上屏

- **自动注册**：目录增 ⇒ 注册 `prac.view`；目录减 ⇒ 撤销，并**剪掉它在持久化里的位置 / 顺序 / 选中**（见布局边界 note 的「视图的状态」）。
- **自动上屏**：按 `location` 映射（`sidebar` → `left`、`panel` → `bottom`、`auxiliarybar` → `right`），**只填空缺**（默认放置的既有语义，持久化优先）。
- **不上屏名单**：Copilot 的 Chat（已定"留着不显示"）、welcome 型（如 `workbench.debug.welcome`）。**名单与落位都在编排，不在机制。**

### 落在哪一层

| 层 | 做什么 |
| --- | --- |
| **机制**（`vscode-host`） | boot、face、宿主组件；把**两个上游服务**（`IEditorService` 的打开文件、`IViewDescriptorService` 的 active 视图）翻成**同一形状的目录 + 一个挂载入口**（`catalogue()` / `onDidChangeCatalogue()` / `hostFor(view)`） |
| **消费者 · 编辑**（`ui-vscode-editor`） | 遍历目录、取 `source: "file"` 的条目，注册成 `prac.view` |
| **消费者 · 视图**（`ui-vscode-views`，新增） | 遍历目录、取 `source: "view"` 的条目，注册成 `prac.view` |
| **编排**（`web-app`） | 默认落位（按 `location`）与不上屏名单 |

- **为什么是两个消费者包**（按 DSH 的形式）：上游就是两条线（`IEditorService` vs `IViewDescriptorService`，`ViewsRegistry` **不处理 editor**）；按 DSH 那条判据"**是否独立演化**"——编辑侧会长 diff / 预览 / custom editor，视图侧会长容器分组 / `when` / webview——它们独立，所以各自成包。**机制统一的是形状，不是把消费者并掉。**
- **目录是机制造出来的**：上游没有一张现成的表同时装着 editor 与 view；机制把两个服务翻成同一形状，`source` 就是"它来自哪个上游服务"。
- **组合（`web-app`）不装特性**：它只落位与排除，不注册 `prac.view`。

## 代价 / 放弃了什么

- **`vscode:sidebar` 这个写死的 view 声明退役** ⇒ **五道 vendor 门按它选宿主**（`verify-layout` / `verify-views` / `verify-focus` / `verify-view` / `verify-file`）要一起迁移——"契约的消费者"那条老账。
- **容器自带的 chrome 不继承**（activity bar、容器内 tab 套 stack）：它们在借用件的盒子里；prac 只按视图单位摆。
- **webview 视图**要真上屏还依赖部署给的 HTTPS 通配端点（已定，见 `docs/architecture.md` §7 #5）；枚举与挂载这半不依赖它。

## 还没落地

- 机制把两个上游服务收敛成**同一形状的目录 + `hostFor`**；`ui-vscode-editor` 改成从目录取 `source: "file"` 的条目（不再写死 id）。
- 新增 `ui-vscode-views`（取 `source: "view"` 的条目），并改 profile 的 link（需提权）。
- 按 `location` 的默认落位与不上屏名单（在 `web-app`）。
- 五道 vendor 门的迁移（它们按 `vscode:sidebar` 选宿主）。
- 验证：cSpell 的 `cSpellIssuesViewByFile` 与一个 `type=webview` 的视图都出现在 prac 的视图目录里、并能上屏。

## Related

- [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)：umbrella（差距 #4 就是这件事）。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：视图模型（一种视图 + 一组属性）、隔离与边界。
- [../../../docs/architecture.md](../../../docs/architecture.md)：目标设计（§3.1 视图契约、§3.2 IDE 面按视图进来）。
- [../../worklog/2026-10-06-vscode-view-catalogue.md](../../worklog/2026-10-06-vscode-view-catalogue.md)：依据（可借用的东西的完整清单、上游事实）。
