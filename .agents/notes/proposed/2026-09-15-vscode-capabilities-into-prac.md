---
status: proposed
---

# Agent Note: 把 VS Code 的能力拆散带入 prac

> 位置：umbrella 见 [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)；命名与 lib 抽取（已完成的那一步）见 [../in-progress/2026-09-13-vs-concept-boundary.md](../in-progress/2026-09-13-vs-concept-boundary.md)。

## Problem

James（2026-09-15）：**"我们想要的不是自定义 workbench，而是把基础能力拆散后带入 prac 中。"** 同日的意图陈述：

> 我是想利用 vscode 的成熟能力和生态来增强 dsh，打造服务于我的 prac。我希望能把 vscode 的 ui 层拆散，渲染进 dsh 中；能力层如 诊断 等功能，最好也能暴露给 agent。也就是说，prac 要同时利用 vscode 和 dsh 两方的生态。

今天的形态与之的落差：prac 拿到的是**workbench 的 8 个 part 实例**，由 prac 的 frame 决定挂在哪个 region。代价已经显形——part 是页面单例（只能 `movePartInto` 搬、不能重建；隐藏 region 必须留 host）、每页只能 `create()` 一次（启动时机被绑在"第一个工作区出现"）、prac 认识的是**上游的 part id** 而不是能力；而且**能力层完全没有第二个消费者**：agent 拿不到 diagnostics / search / tasks 这些状态。

已裁决的三点（同日问答）：**粒度目标 = L2（拆到 view / widget，保留扩展贡献能被 prac 渲染）**；**第一个验证件 = explorer 的单个 view**；**容纳单位 = `view`**——container（视图容器）只是**可选分组**、part 只是**可选的高级形态**（整块标准 IDE 区域），都不是 prac 组合的单位。理由：prac 的 `prac.view` 目录里本来就有 **`dsh:*` 与 `vscode:*` 两方 view**，它们已经是同一种东西；用 part 当单位等于让 prac 说 workbench 的编排词汇，并继承它的"单实例 / 只能搬"约束。

## 理想形态（我的提案，待 James 确认）

**一句话**：把 VS Code 从"一个 app"降为"一个**页面级能力内核** + 两张适配面"——一张给 prac 的 UI（**view 目录**：与 prac 自己的 view 同列一处），一张给 agent（同一批服务的**可观察状态 + 动作**）。补丁的职责随之从"换掉它的编排"变成"让它能**无壳**启动、并把 view 交出来"。

### 三层

| 层 | 是什么 | 谁拥有 |
| --- | --- | --- |
| **内核 kernel** | **每页一次**：DI 服务图（files / config / storage / workspace / language / SCM / terminal / debug / tasks）、扩展宿主、注册表（views / menus / commands / diagnostics） | lib；prac 只提供"哪个工作区、哪个远程" |
| **view 目录 views** | 每个有 UI 的能力 = 一个 **view**：`view(id) → { element, layout(dim), setVisible, focus?, dispose? }`，并附 `singleton?` / `parkable?` / `需要 container?` 的诚实标记。**container 是可选分组，part 是可选的高级形态**（整块标准 IDE 区域）；editor group / 终端 / 差异 / webview 等非 view 能力走**同一套句柄形状** | lib 负责适配（chrome、主题、context key、焦点与命令路由）；prac 负责**放置与生命周期** |
| **能力面 capabilities** | 同一批服务的**数据 + 动作**：`diagnostics(uri?)` / `symbols` / `references` / `search(query)` / `scm` / `tasks` / `tests` / `terminalOutput` / `commands.list/invoke`；每个都是 observable + 动作 + **provenance**（工作区 / 远程 / 文件版本 / 时间） | lib 定义与实现；DSH 侧投影成 agent 工具 |

### 为什么这样同时吃到两方生态

- **VS Code 生态的入口是贡献点**（`contributes.views/commands/menus/languages/debuggers`）。理想里它们不落在 workbench 的 part 上，而是被**投影进 prac 自己的目录**（`prac.view` 已有 `vscode:` 与 `dsh:` 两个生产者）：VS Code 的 view 贡献 = 一个 prac view，命令 = prac 命令面板 + agent 工具。**扩展不用改，prac 用自己的壳渲染它。**
- **DSH 生态的入口是 slot / service**：prac 的 frame、会话、工作区、agent 循环都在 DSH 里；lib 对 DSH 零依赖，prac 层做绑定（工作区身份、放置、工具投影）。
- **同一服务图、两个面**：agent 读的 diagnostics 与 UI 的 problems 读同一个 `ILanguageDiagnosticsService`；agent 调的命令与用户点的是同一个 `ICommandService`——没有第二份真相。这是"拆散"与"再包一层 API"的分水岭。

### 与今天逐条对照

| 今天 | 理想 |
| --- | --- |
| 单位是 **part**（workbench 编排的产物，页面单例） | 单位是 **view**（`dsh:*` 与 `vscode:*` 同列一处）；**“编辑器” = 单个 file view**（一个文件的编辑面），**tab 与分栏由 `stage` 提供**，不是 editor part；container 与 part 只作为可选的高级形态 |
| 页面单例 + "只能搬不能重建" | 内核页面单例；**view** 可多实例（能 dispose 的 dispose，不能的显式标 `singleton`） |
| `boot()` + `partHost(partId)` | `kernel.ready()` + `views.view(id)`（container / part 是它的高级形态）+ `capabilities.*` |
| 只有 UI 一个窗口看能力 | UI 与 agent **两个面**；**不挂任何 view 时能力照样可用** |
| 补丁换掉 composition（自写 layout service） | 补丁让 workbench **可无壳启动**（"服务造 part"改为按需）+ 交出 view |

### 不可让步的约束（否则理想会漏气）

1. 扩展宿主、文件/配置/存储/watch 必须**每页一份** ⇒ 内核是页面单例，不是设计选择。
2. 扩展的 UI 只能通过贡献点落地 ⇒ 必须**投影**，不能重实现。
3. 工作区身份在 boot 时定死（上游约束，已撞过）⇒ prac 层负责在对的时刻把工作区交给内核。
4. **主题 / 焦点 / 快捷键 / 存储的归属要写死**：判断是——view 内部的键绑定归 VS Code（它的 context key 体系），prac 全局与 agent 动作归 DSH，边界处用显式 scope 交接；存储各管一半（VS Code 的 profile/workspace 存储 vs DSH 的 storages），不互相镜像。

### 理想里最看重、今天完全没有的两条

1. **agent 面要"settled + provenance + 分页"**：VS Code 的状态是异步收敛的（诊断等 LSP、SCM 等 git 进程）。只返回"此刻的值"，agent 会基于半成品行事 ⇒ 要暴露**静默/版本**语义（`waitForSettled(uri)`、`version`）与来源；diagnostics 这类还可能很大 ⇒ 结构化分页与摘要，而不是把原始数组塞给模型。
2. **无 UI 可用**：agent 要能在没有编辑器、没有 problems 面板时读诊断、跑任务、查引用。这是"能力层与 UI 层拆开"最硬的判据——**若某能力只在某个 part 挂着时才工作，它就没被拆开**。

## 关键结构事实（都在 `.build/workbench/upstream` 里，可复读）

1. **`createWorkbench` 是上游给"换一个 app"留的缝**（`workbench/browser/web.main.ts:103,271`：`IBrowserMainWorkbench` 只有 `{ startup, onWillShutdown, onDidShutdown }`）。上游自己的第二个 app 用的也是它：`sessions/browser/web.main.ts:33` `SessionsBrowserMain extends BrowserMain` 覆写 `createWorkbench` → `createSessionsWorkbench`，并另覆写 `createWorkspaceConfigAndStorageServices` 换掉工作区/配置服务。**我们的补丁用的正是这道缝**，不是 hack。
2. **part 不是 app 造的，是服务造的**（这一条改变了备选的判断）：
   - `IPaneCompositePartService` 的实现在**构造函数里就 eager 造** `PanelPart` / `SidebarPart` / `AuxiliaryBarPart`（`browser/parts/paneCompositePartService.ts:37`）；
   - `SidebarPart` 自己造 `ActivitybarPart`（`browser/parts/sidebar/sidebarPart.ts:71`）；
   - `ITitleService` 造 `TitlebarPart`（`services/title/browser/titleService.ts`）；`IStatusbarService` 造 `StatusbarPart`（`services/statusbar/browser/statusbar.ts`）；`EditorParts` 造 `MainEditorPart`（`browser/parts/editor/editorParts.ts`）；
   - `Part` 在构造时自己向 layout service 注册（`browser/parts/part.ts:61`：`layoutService.registerPart(this)`），而 part 的 DOM 只有在别人调 `part.create(parent)` 时才进文档。
   - ⇒ **服务图一起来，6~7 个 part 就已经被造出来、并注册进我们的 layout service**。"不创建任何 part"不是一道可加的缝，而是"不起这些服务"；`deferParts` 之所以有效，是因为 part 只"存在"而不"进 DOM"。
3. **view 容器可以造进任意外部 parent**：`ViewPaneContainer.create(parent: HTMLElement)`（`browser/parts/views/viewPaneContainer.ts:383` → `new PaneView(parent, options)`），ctor 只依赖注入的服务（含 `IWorkbenchLayoutService`，即我们的载荷）＋ `viewDescriptorService.getViewContainerById(id)`（容器由 contributions 注册；contributions 由载荷 `start()`，`vendor/vscode/overlay/embeddedWorkbench.ts:285`）。
   ⇒ **L2 不需要新的补丁缝**：载荷已经是"服务图 + contributions 起来、part 只按需挂"。要加的只是"把一个 view 容器造进外部元素"这一个能力。
4. **part 的 id 与 view 的 id 不是一回事**：DOM 上的 `PART_HOST_ATTR`（`data-vscode-embed-part-host`）携带 **part id**（契约与载荷默认路径都按它查 host），而 frame 与闸门说 **view id**（`vscode:editor`）。两者要显式映射，不能假设相等（2026-09-15 踩过）。

## Proposal（两步，都是加法；第一步不改补丁）

**次序（James 2026-09-15）**：先把 **B1（单 view 宿主）** 做完验完，**再**做 agent 能力面（capabilities）。所以本 note 的 B1/B2 是 UI 侧；能力面是紧随其后的下一块（形状已在「理想形态」里定，实现押后）。

### B1：**单 view** 先行（已完成，2026-09-15）

目标：把 **explorer 的文件树 view** 挂进 prac 的一个 region；prac 侧**不认识 container，也不认识 part**。

1. `vendor/vscode/overlay/bridge.ts`：face 加 `mountViewInto(viewId, element)`（契约是我们自己的文件，不进补丁；stage 进 checkout 供两侧编译）。
2. `vendor/vscode/overlay/embeddedWorkbench.ts`：实现它——用 `viewDescriptor.ctorDescriptor` + `instantiationService.createInstance(...)` 造 `ViewPane`，挂进外部元素；生命周期进 `disposables`，`layout()` 时把 host 尺寸算进去。
   - **可能要"偷偷"造一个 container 当它的 parent**：VS Code 里 view 的家是 container（`IViewletViewOptions` 带容器引用），所以实现上或许必须有一个 container 对象存在。这是**实现细节，不暴露给 prac**——prac 只拿到 view 的句柄。
3. `vendor/vscode-embed/src/client/index.ts`：句柄加 `view(viewId)`（与 `partHost(partId)` 并列；`partHost` 从此定位为**高级形态**的入口，**加方法不改形状**）。
4. `packages/client/vscode-host` + `packages/bundle/web-app`：`pracVscode` 面加同名字段；explorer 座位改成挂 view（例如 `workbench.explorer.fileView`），**不挂 sidebar part**。

判据：文件树出现在 prac 指定 region；`[data-vscode-embed-part-host]` 里**没有** sidebar part；四闸门仍绿；**能否 `dispose` 后重新创建**（能 ⇒ view 真的可以多实例，这是它优于 part 的硬判据；不能 ⇒ 记录它其实仍带 container 级单例）。

### B2：把"挂哪一级"做成能力表（B1 成功后的那一半；**能力面的具体提案见下面新增的 B2 一节**）

`pracVscode` 从"part 宿主"变成**能力句柄表**：`view(id)` 为主，`editor(file) → view`（单文件编辑面，**L1 现在挂的 `workbench.parts.editor` 是过渡形态**），`viewContainer(id)` / `part(id)` 作为**高级形态**可选（后续再加 service 句柄）；座位与编排按能力名取。lib 的目标形状随之从 `boot/partHost` 走向 `kernel / views / capabilities`（**agent 面是新增的一块，目前一个字都没写**）。

## B2 提案（2026-09-15，待 James 裁）：能力面

**一条能力的形状（统一外壳，先定这个再谈内容）**——UI 与 agent 消费同一个句柄：

```ts
interface Capability<T, A> {
  snapshot(): T;                                // 当前值
  subscribe(listener: () => void): () => void;  // 变化通知（UI 也用它）
  settled(): Promise<void>;                     // 异步源收敛（LSP / git 进程 / 扩展宿主）
  readonly version: number;                     // 单调版本：provenance 的一部分
  readonly actions: A;                          // 具名动作（关闭 / 保存 / 打开 …）
}
```

每条回复都带 **provenance**：`{ workspace, remoteAuthority, at, versions }`。**没有 `settled` 与 version 的能力不算能力**——agent 会拿半成品当真值（这是"理想里最看重"那条的落地）。

**第一批（按价值/不确定性排序）**

| 能力 | 内容 | 为什么它第一个 |
| --- | --- | --- |
| `editors` | 打开的文件、active、**dirty**、**preview**；`actions.close(resource)` | 决定 17 的 tab 条**缺的就是这一半**（脏点 / 预览斜体 / ×），也是"用户正在看什么"的上下文来源；tab 的 × 走 `actions.close`，**不新增 face 方法** |
| `diagnostics` | 按 URI 的 markers + `settled()` + version；**分页 + 摘要**（不把原始数组塞给模型） | 旗舰：IDE 知道而 agent 不知道的东西，且异步收敛语义最典型 |
| `documents` | 当前文件内容 / 选区 / 版本 | 决定 12/13 已定"上下文入并入能力面"，这是它的载体 |
| 之后 | `search` / `scm` / `tasks` / `symbols`+`references` / `terminal` | 每个都要单独定"数据结构 + 收敛判据 + 成本" |

**三层落点（每层形状不同，别混）**

| 层 | 谁 | 形状 |
| --- | --- | --- |
| 内核侧（浏览器、prac-free） | `vendor/vscode-embed` | `capabilities: { editors, diagnostics, … }`，直接用内核服务实现（`IEditorService` / `ILanguageDiagnosticsService` / …） |
| prac 客户端 | `prac-client-vscode-host`（或新包） | `pracVscode.capabilities.*`；UI 直接订阅（tab 的脏点就是一个订阅者） |
| prac **host** 侧（DSH 工具） | 新包 `prac-host-vscode-capabilities` | **声明 `/remote` 能力** + `ctx.tools.register(defineTool({ name, description, parameters, execute }))`：`vscode_diagnostics` / `vscode_editors` / `vscode_open_file` / `vscode_command`；host 通过 `ctx.remote` 调到页面侧的实现 |

**这条通道是 DSH 原生的**：`@deepseek-ai/dsh-api-remotes` 是"Host Remote 能力的两面 BFF"——**host 声明能力、client 用生成的 `/remote` 制品挂载实现**（`ctx.remote.$mount()` / `$on`），工具在 host 侧注册（`packages/fs/tool-present` 是最小的形状样本）。所以"把 vscode 能力交给 agent"不是我们自造协议，而是：**能力句柄在页面、实现在 remote、工具在 host**。

**不可让步的判据（否则"拆开"没发生）**

1. **无 UI 也可用**：不挂任何 view / part 的页面上，`diagnostics` / `editors` 照样可读。用一张**只开能力、不挂 view** 的页面测——这是"能力层与 UI 层真的分开了"最硬的证据。
2. **两个消费者、同一真相**：tab 的脏点与 agent 读的 `editors` 是同一个句柄、同一个服务，没有第二份。
3. **settled + provenance + 分页**：如上一节。

**不做什么（防跑偏）**

- 不做 `executeCommand(id, args)` 当万能出口——那正是"拆散"的反面（再包一层 API）；命令要么作为**具名动作**出现在相关能力上，要么在 `vscode_command` 里限定白名单。
- 不把 VS Code 的 UI 状态镜像进 DSH 的 store：各管一半，边界处显式 scope（与「不可让步的约束 4」一致）。

**第一步的验收（可执行的样子）**

- vendor 门（新 `verify-capability.mjs`，或并入 `verify-file`）：**不挂任何 view** 的页面上——`editors.snapshot()` 有打开的文件；`diagnostics.snapshot(uri)` 有该文件的条目；`settled()` 在 LSP 收敛后 resolve（构造一个"先返回空、后到位"的场景，断言它**不**提前 resolve）；`version` 单调；`actions.close(uri)` 之后文件从 `editors` 与 tab 同时消失。
- prac 侧：键入后 tab 出现脏点（`editors` 的第一个 UI 消费者）。
- DSH 侧：`vscode_diagnostics` 工具在无 UI 页面返回结构化诊断（host 侧工具测试）。

**与当前实现的接口（都是加法）**：`pracVscode` 现有 `partHost` / `viewHost` / `fileViews` / `onDidChangeFileViews` / `fileHost` / `fileResource`；B2 加 `capabilities.*`。键（uri / view id）的翻译仍归 host——和 `fileResource` 同一条理由。

## Alternatives

**A：服务图 handover（补丁加"我只要服务图，不要 composition"的路径，把 `serviceCollection` / `InstantiationService` / lifecycle 交给 embedder）**

- 收益**比看起来小**：由事实 2，part 是服务 eager 造的，不建 composition 也照样被造；要真正"零 part"，得连 `IPaneCompositePartService` / `ITitleService` / `IStatusbarService` / `IEditorGroupsService` 这些服务都不起——那等于 prac 自己写 bootstrap，与"保留能力"直接冲突。
- 代价**比看起来大**：补丁要动 `web.main.ts`（我们唯一改上游已有文件的地方），且要设计 handover 的生命周期/关闭语义；contributions 的 `start(accessor)`、`IEditorFactoryRegistry.start`、`WorkbenchContextKeysHandler`、aria/hover 这些现在由载荷做，handover 后归属要重新安置。
- **结论：不作为 L2 的第一步**；只有当"未挂载 part 的对象图成本"被实测证明值得时，再谈。

**L3：service 级，prac 自己当组合根**

需要重造 view / menu / command 注册表的宿主，与"保留完整 IDE 能力与扩展生态（Tier 2：语言包、GitLens）"冲突。**记录在案，不做。**

## Costs / risks（诚实清单）

- **L2 ≠ prac 自己画树**：`ViewPaneContainer` 自带上游 chrome（`PaneView` 的 sash、`ViewContainerMenuActions`、每个 view 的 header actions、容器内拖放）。L2 的准确含义是"**prac 决定把上游的 view 容器放在哪、挂几级**"，不是"prac 重画 explorer"。
- 容器把"可见视图数"写进 `IStorageService`（`${id}.numberOfVisibleViews`，`StorageScope.WORKSPACE`）⇒ 依赖工作区身份正确（`URI.revive` 那条已修）。
- 未挂载的 part 仍占对象图与部分后台工作（editor group model、activity bar 等）。这项成本**可测**（起页后的构造计数/堆），是决定"要不要走 A"的唯一依据。
- 单 **view** 级（比容器更细）要直造 `ViewPane`，其 `IViewletViewOptions` 需要容器引用 ⇒ 先做容器级，单 view 级作为 B1 成功后的下一个问题。

## Verification

**B1 已验收**（当时的数字：四闸门 24/24 · 33/33 · 12/12 · 1/1 ＋独立页 smoke）；决定 17 之后口径变为 vendor `14/14 · 28/28 · 9/9 · 6/6 · 7/7 · 17/17`（layout · views · focus · regions · view · file）＋ prac 四门 `6/6 · 6/6 · 6/6 · 11/11` ＋ smoke `8/8`。B2 的验收见上面「第一步的验收」。

## Open questions

1. 理想形态（三层：kernel / views / capabilities）是否被确认？确认后 lib 的目标形状要不要直接按它分层，而不是继续往 `partHost` 上加方法。
2. **高级形态（container / part）什么时候真的需要、chrome 保留到什么程度**：整块标准 IDE 区域（"把 sidebar 原样搬来"）与逐个 view 组合，是两种用法；全留 chrome 最省事，去掉要换掉 `ViewPaneContainer` 的 ctor options 与 `PaneView`。
3. B1 之后第二个能力件选谁（search / SCM / outline / terminal / editor group）。
4. **已定（2026-09-15）**：agent 能力面**排在 B1 之后**；上下文入（当前文件 / 选区 / 打开的 view）并入它。它决定"能力层是否真的被拆开"，与 L2 是两件事。
5. 要不要现在就测"未挂载 part 的成本"，用它决定 A 是否值得。
6. **已闭合（2026-09-15）**：容纳单位定为 `view`（umbrella 决定 2b），原"决定 2/3 与 09-15 方向相冲"的张力消解；container / part 退为可选的高级形态（"何时真的需要"列在 umbrella §8）。
7. **与 umbrella §8 的能力/生态开放项互相引用**（扩展宿主 web → server、terminal PTY 放在 DSH host、DSH ↔ workbench 状态桥、内建扩展编译 12/106）——它们与"agent 能力面"是同一条决策链的前后段，但目前两条 note 互不链接细分。

8. **已闭合（2026-09-15，决定 17 落地）**：路径是 `CodeEditorWidget` + `ITextModelService.createModelReference(uri)`（镜像工作台的 `TextCodeEditor.createEditorControl`）。**实测带走的**：工作台自己的文本模型（语言特性 / markers / undo / save）。**实测没有的**：挂在 `EditorInput`+`EditorPane` 上的贡献——面包屑 / peek / diff 与自定义编辑器 / 热退出。⇒ `editor(file) → view` 成立；上面那份"没有的"清单就是能力面（尤其 `diagnostics`）要补的洞，也是"tab 的脏点/预览/关闭要 `editors` 能力"这条结论的证据。
9. **B2 是否按上面的提案开工**：先做 `editors`（把 tab 的脏点/预览/关闭补齐）还是先做 `diagnostics`（旗舰 agent 用例）？我建议 `editors` 先行——它同时是**第一个 UI 消费者与第一个 agent 消费者**，能把"两个消费者、同一真相"这条判据一次验掉。
