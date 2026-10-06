---
status: in-progress
---

# Agent Note: VS Code 的视图进 prac 的视图目录

> **这是哪件工作**：`docs/architecture.md` §3.2（"扩展贡献的视图也按视图进来"）落到实现的一步；umbrella 见 [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)。
> **状态**：挂载模型与枚举层已裁（James 2026-10-06），工作在进行中。

## Problem

prac 的侧栏 view **写死**到一个 VS Code 视图：`packages/client/vscode-host` 的 `VSCODE_VIEW_OF_SEAT = { 'vscode:sidebar': 'workbench.explorer.fileView' }`。于是**扩展贡献的视图从不出现**（cSpell 的 `cSpellIssuesViewByFile`、webview 视图、探针那些）——缺的不是挂载能力（face 的 `mountViewInto` 已经会等未注册的视图并重试），而是**枚举**。

## 设计

**每个 VS Code 视图是一个 prac 视图**——不是"一个容器一个 view"，也不用一张手写的映射表。

- **枚举 `activeViewDescriptors`**。上游把容器里的视图分三层：`all`（注册集）、`active`（`when` 成立集）、`visible`（`active` ∧ 用户没隐藏——**容器实际排布的那批**）。
  - prac 的 frame 扮演的就是上游容器"排布"的角色 ⇒ prac 注册的是 **`active`**：`when` 一变，视图就进出可选集。这也是上游自己用的那一层（容器空不空、viewlet 渲染哪些、`viewsService` 判某视图在不在都在用它）。
  - **"在不在屏上"只归 prac 的 frame 与持久化**，**不搬上游的 `visible`**——否则 VS Code 的显隐状态会成为第二个"在屏上"的真相源。
- **`when` 与注册都可订阅**：模型自己订阅 context key（`onDidChangeActiveViewDescriptors` 覆盖 `when` 翻转），容器/视图的注册注销走 `onDidChangeViewContainers`。prac 侧据此**动态增删**视图。
- **视图 id 带来源标签**：`vscode:view:<viewId>`（本仓约定：借来的词带来源）。
- **默认落位按 location 映射**：sidebar → `left`、panel → `bottom`、auxiliarybar → `right`；**只填空缺**（默认放置的既有语义，持久化优先）。
- **契约在 `vendor/vscode/overlay/embedBridge.ts` 定义一次**，lib 只再导出。face 增一个**枚举面**（当前列表 + 变更事件）；它只提供机制，不带政策（不决定 prac 摆哪）。

## 代价 / 放弃了什么

- **`vscode:sidebar` 这个写死的 view 声明退役** ⇒ **五道 vendor 门按它选宿主**（`verify-layout` / `verify-views` / `verify-focus` / `verify-view` / `verify-file`）要一起迁移——"契约的消费者"那条老账。
- **容器自带的 chrome 不继承**（activity bar、容器内 tab 套 stack）：它们在借用件的盒子里，prac 只按视图单位摆。想按容器摆是另一条路（已否）。
- **webview 视图**要真上屏还依赖部署给的 HTTPS 通配端点（已定，见 `docs/architecture.md` §7 #5）；枚举与挂载这半不依赖它。

## 还没落地

- face 的枚举面（列表 + 变更事件）与 prac 侧的动态注册。
- 按 location 的默认落位。
- 五道 vendor 门的迁移。
- 验证：cSpell 的 `cSpellIssuesViewByFile` 与一个 `type=webview` 的视图都出现在 prac 的视图目录里、并能上屏。

## Related

- [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)：umbrella（差距 #4 就是这件事）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：目标设计（§3.1 视图契约、§3.2 IDE 面按视图进来）。
- [../../worklog/2026-10-06-vscode-view-catalogue.md](../../worklog/2026-10-06-vscode-view-catalogue.md)：依据与过程记录。
