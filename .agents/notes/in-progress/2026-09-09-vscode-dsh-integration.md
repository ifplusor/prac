---
status: in-progress
---

# Agent Note: prac 的界面形态 —— VS Code × DSH 融合

> 这是这项工作的 **umbrella**（综合性叙述，汇总各个 step）：主线定义、需求约束、决定（含被否决的路线）、开放问题。
> 步骤 note：[2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)（概念边界与命名，实现已完成，待签字）；[../abandoned/2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)（把能力拆散带入 prac，方案待裁）；[../abandoned/2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)（两半之间的通信层，设计待裁——四项）；[../in-progress/2026-09-19-architecture.md](../in-progress/2026-09-19-architecture.md)（**从需求出发重做架构**：需求清单 + 推导 + 待裁，取代了旧设计）；[../in-progress/2026-09-21-p1-ext-host-chain.md](../in-progress/2026-09-21-p1-ext-host-chain.md)（**P1 第一条链的实现计划**：已核实的事实 + 三条裁决 + 步骤 + 验证）；[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)（**借来的组件与 prac 框架的边界**：隔离与对等、浮层归谁——**已裁，工作在进行中**）；[2026-10-06-vscode-view-catalogue.md](2026-10-06-vscode-view-catalogue.md)（**VS Code 的视图进 prac 的视图目录**）；[2026-10-07-editor-host.md](2026-10-07-editor-host.md)（**prac 自己的编辑器宿主**）。
> 另有一条：[2026-10-15-ui-layout-stack.md](../resolved/2026-10-15-ui-layout-stack.md)（**stack 的行为定义**：先定行为再选实现；**已实现并签收**）。
> 口径（**§3.8 的断言分层之后**）：**vendor 侧集成门**写作 **14/14 · 28/28 · 9/9 · 6/6 · 7/7 · 33/33**（layout · views · focus · regions · view · file）；第六门 `verify-extension` 是**条件门**（装了 VS Code 扩展才跑 5 项，没装时明确 `SKIPPED`——SKIP 不是通过）；**prac 侧活体门**写作 `verify:stack 6/6 · verify:bottom 6/6 · verify:persistence 6/6 · verify:split 11/11`；所有 part 计数一律 **8/8**；**单测**写作 `pnpm test`。

## 1. 这个工作是什么（主线定义）

1. **（2026-09-09）** 把 VS Code 与 DSH 结合成**一个**形态：prac 的界面 = agent 与 IDE **深融进一套 UI**，不是两套并列。保留**完整 IDE 能力与扩展生态**（Tier 2：语言包、GitLens 等 UI 扩展），**不要 VS Code 的布局**；以 agent 为中心，**IDE 是可按需下潜的重工具**。
2. **（2026-09-19）现在的主线**（James）：**prac 的界面是给人用的**——和 agent 打交道的界面 + 帮他干活的 IDE 界面；**另一头 prac 是 agent 的运行时**（循环、工具、上下文、审批、沙箱、会话、持久化）。**中心是人和 agent 的交互**：chat 就是通道（松耦合），白板就是工作区里的文件。设计见 [架构重做](../in-progress/2026-09-19-architecture.md) 与 [docs/architecture.md](../../../docs/architecture.md)。
3. **（2026-09-19）本次范围**：**只把两边现有的东西结合起来，不往 DSH 里加能力**——VS Code 有而 DSH 缺的，先记下来，不立刻加。结合点：① VS Code 的语言服务器 → `ctx.lsp` 的一个 provider；② VS Code 的 MCP server 定义 → DSH 现有的 MCP 客户端；③ VS Code 的界面 → prac 的 view；④ 人和 agent 对着同一份工作区文件。
4. **（2026-09-15）那条旧主线已作废**——"把 VS Code 的 UI 层拆散、把能力层（如诊断）暴露给 agent"：能力那半被扔（诊断只是缓存、agent 侧归 DSH）；"拆散"那半作为 R2 / R3 / R4 的要求保留下来。见 [架构重做](../in-progress/2026-09-19-architecture.md) §4。

**阶段切换**：此前在讨论 prac 的目标/理念，并以具体任务体验工作流（C1、C2）；进行到 C2 时 James 叫停，转入融合形态本身。叫停理由原文只有「我发现我们不应该再继续了」，推断是优先级——**待确认**。本工作**不欠**阶段二的那些机制（决策空间 / 以审决策为主界面）；它们要重新进入主线，需 James 重新裁决。

## 2. 需求约束（推导 UI 形态的前提）

### ① 协作模式（James 述）

- **共享工作空间 + 结对**：工作空间是 agent 与人**共有**的。流程：人提出想法/任务 → 两人在**一块白板（如 notes）**上讨论（细化、澄清目标、设计方案与计划）→ agent 实施（加工工作空间内容或把成果放回）→ 人旁观、可**打断**提醒纠偏、也会在 agent 需要时出现帮它操作 → review。变体：放手让 agent 自主完成一系列工作，或**叫停它自己上**。
- **白板与共识重要**；**保留工作记录、按需回顾**是更大的共识。
- **两个并行工作者、异步交流**：不共享同一个「当前阶段」⇒ **不是模式机**：没有「商定 / 实施 / 接管」这种要声明的状态。**谁在驱动是事实，不是状态**；**打断 = 说话 + 一个「停」**。
- **UI 是注意力的跟随器**：关注什么就把它拿到中间；换焦点要随手自然，并且要有**返回栈**。
- 三种角色（白板/记录、工件、对话）**不是三个固定格子**；**白板本身就是工作区里的文档**（notes 是文件）⇒ 白板与工件是同一种东西、只是角色不同 ⇒ 不需要两个面板。**恒在的是「环境」，不是「模式」**：导航（工作区/记录树）、**通道**（异步留言：你说的话等我看到）、**我在改什么**。
  - **（2026-09-19 澄清）通道不是单独的一个东西——它就是 chat**：人和 agent 通过 chat 说话，**chat 本身就是松耦合的**（谁不在都不阻塞，回来看会话记录即可）。所以不单独做"留言"机制，也不做模式机。
- 主场景 = **单工作区下持续、重度工作**；快速切换 / 同时多工作区更好，但不是主场景。

### ② 布局规格（James 定）

若 DSH 的布局能力有缺陷，**就基于它做我们自己的布局**（像改造 VS Code 一样）：主操作台 = 注意力焦点，四周是辅助操作面板；交流时 **chat 是焦点**，审阅计划/方案时**白板是焦点**且 chat 在一边随时可发消息，审阅工作区内容时**编辑器是焦点**、chat 在一边、资源浏览器在另一边；主操作台**可分栏**；**terminal 随时调出**；各窗口/视图**按需显示**、能方便隐藏收起与快速调出。

## 3. 决定（现在的设计为什么长这样）

> 这一节只写**当下的立场**：决定了什么、为什么、放弃了什么。
> 设计已在 **2026-09-19 定案**（James：「放弃当前的架构设计，从需求出发，从头设计架构」）：为什么这么设计、旧设计哪些留着哪些作废，见 [架构重做](../in-progress/2026-09-19-architecture.md)；**面向目标的设计**见 [docs/architecture.md](../../../docs/architecture.md)。
> 这一节是**已经定下的**那些（为什么是现在这个形状），差距与还没做的在 §4。

### 3.1 总纲：两端结构与主干

- **prac 是 CS/BS 两端结构，主干是 DSH**。看架构**先分 client / server**，不是先分 DSH / VS Code——两个系统各自都跨在线上。
- **DSH 的扩展方式就是 DSH 插件**：同一棵树、同一地址空间，耦合是 in-process 的 `inject`。**"扩展宿主"是 VS Code 的概念，不能带到 DSH 上**——两者是不同的机制，不是一个角色的两种形状。
- **VS Code 是主干上的一族 DSH 插件**（不是"被嵌进来的第三方 app 加一层接缝"）：server 半边拥有它的进程与能力，client 半边把 UI 贡献进 frame；bridge / part host / `prac-vscode-embed` 是**这族 DSH 插件的内部实现**。
- **本次只做结合**（James 2026-09-19）：把 VS Code 现有的东西接到 DSH 现有的接口上；接口不够用时**只记录、不扩**（§1 第 3 条）。
- **三层各归其位**：`vendor/vscode` = 引入的上游源码树 + 我们的 patch；`vendor/vscode-embed` = 在其上封装的 **lib**（可利用、不绑定 prac，**只给机制、不背政策**）；**政策**（谁放哪、何时启动、哪个 view 用哪个 part、能力怎么给 agent、code server 的生命周期）全在 DSH 插件层。

### 3.2 容纳与单位

- **DSH 页是 shell**，VS Code 的 parts 挂进 DSH 的**真**布局 region（不 island 化）。
- **部件永远是被容纳的一方**：经 host 挂进来，**不是搬过来**。
- **容纳单位 = `view`**：`prac.view` 目录里同时住着 `dsh:*` 与 `vscode:*` 两方 view，它们已经是同一种东西；**container 是可选分组**、**part 是可选的高级形态**（整块标准 IDE 区域），都不是 prac 组合的单位。
  - 为什么：用 part 当单位等于让 prac 说 workbench 的编排词汇，并继承它"单实例 / 只能搬"的约束。
  - **（2026-09-19 James 再确认）编排单位就是一个视图**，不是整块区域；编辑器那一侧的视图 = 一个文件一个视图（§3.5），**tab 是区域级的**（`center` 默认 `tab`、不支持 `stack`）。

### 3.3 框架归属与分层

- **frame 由 `ui-layout` 拥有，只借 VS Code 的行为**（视图契约、`GridDescriptor` 的树形摆放、收起记宽、maximize、layout policy 的写法）；**不让它的 grid 拥有 prac 的 frame**。
- **机制与组合分层**：机制（`ui-layout`）/ 编排（`web-app`）/ VS Code 侧（vendor + 两个 prac 行）。**机制层不含任何具体视图名与默认落位**。
- **code server 的进程归主干**：`prac-host-vscode` 自己 spawn 它（`out-vscode-reh/server-main.js`，不用 `--folder`——工作区由 client 的 boot 决定），端口取空闲、等 `/version` 就绪、随该 DSH 插件 dispose 收掉；环境变量（`PRAC_CODE_SERVER_URL` / `_ENTRY` / `_PORT` / `_PATH`）是逃生口。页面不再拥有它。
- **扩展宿主也归主干（P1）**（James 2026-09-19）：主干自己连一条 ExtensionHost 连接，**不依赖页面**（页面关着语言服务照样在）。按需实现主线程那一面：三条初始化推送 + `ExtensionService` + `Errors` + **文档** + 挑出来的那几个 `$provide*`。**宿主几个**（James 2026-09-21 定）：**agent 侧一个工作区一个宿主**（同工作区的多个 agent 共用；理由与 seam 的限制见 [`docs/architecture.md`](../../../docs/architecture.md) §4.2），**UI 不与 agent 共用**（UI 仍按上游：每个页面一个宿主）。代价：agent 那份激活上下文仍是额外的一份（上游的 UI 宿主照旧），并跟着上游漂移；宿主死了要能自己起回来。**硬前提**：文档必须由我们喂给扩展宿主（取文档时没有判空）。
- **两个服务主次分明**：`ctx.layout` 是**兼容 shim**（只服务 `ui-workspace` / `ui-sidebar` / `ui-sidebar-right` 用的 5 个方法，可整体删除）；`ctx.pracLayout` 是 prac 机制（含 `bindRoles`），机制**不知道谁是 sidebar**。

### 3.4 对上游的姿态

- **不 fork DSH**：替换它的布局走它自己的组装层（bundle patch：`insert` / `disabled`，`disabled` 必须排在 `insert` **之后**）。
- **不引入第三方改造**（`monaco-vscode-api` / Theia），**也不把源码树拷进项目**：直接对官方 Code - OSS pin + 小而可审的 patch。
- **布局自己重做，但只做便宜的那层**：parts 编排 + layout service 我们 own；**service 层与 VS Code 扩展渲染不拆**（拆 ≈ `monaco-vscode-api` 级改造，等于放弃"上游可控"）。这是"保留完整生态"的落点。
- 做法：自写 workbench + layout service（不走 patch 经典 `Layout` 那条路），`IWorkbenchLayoutService` 按 prac 需要实现，模板 = `src/vs/sessions/`；补丁的目标是把 workbench **从 app 变成 library**。

### 3.5 区域与编辑器

- **区域的形态**：常驻区（区域 id `left` / `right`；**角色**用平台名 `primarySidebar` / `secondarySidebar`，绑到 DSH 的 `dsh:sidebar` / `dsh:rightbar`——位置中立，区域 id 不动、改名要升持久化 key）不分栏、但**都可堆叠**（可折叠 header、排序、尺寸记忆）；**布局模式（分区 / `tab` / `stack`）由机制提供、由「区域名」绑定**，每个子区域跟随它所在区域名的绑定；**`center` 的分栏必须带视图**（对齐 VS Code 的 editor group）；新增**常驻底栏**（`bottom`，默认收起，放 terminal / 输出 / 问题）；`center` 支持**任意方向**分栏（上下左右、可嵌套）——**任何方向都造不出空 region**。
- **对话是普通 view**：`dsh:main:conversation` 可被编排放到任意 region（默认侧边），注意力可把它提升到中间；`selectPanel` 只把**新选中的**视图放进编排给它的 region，不再"替换当前 main 视图所在的那个 region"。
- **VS Code 侧提供"单个 file view"**：prac 的"编辑器" = **一个文件一个视图**，**不是 editor part / editor group**；**tab 是区域级的**（不是 `center` 专有，**frame 级标签页**）、**分栏是区域的性质**——`center` 默认 `tab`、不支持 `stack`；frame 本身仍不认识"编辑器组"。
  - 为什么：用 VS Code 的 editor part（自带 tab 条与 group 模型），chat 与 editor 就无法在 center 里自由并排。
  - 代价：`workbench.parts.editor` 现在是**过渡形态**；lib 的 editor 句柄应定义成 `editor(file) → view`。

### 3.6 工作区与状态

- **工作区是界面的一等关系**：单窗口 + **切换即重载**；**多窗口同一工作区要支持**；UI 上有**专门的工作区选择入口**（精确切换，也作初始落地页）；**未激活工作区**时 DSH 壳仍在、IDE 侧不启动；per-window 与 per-workspace 的 UI 状态分开，**多窗口同一工作区各一份**；**对话在创建时绑定工作区**。
- **持久化（最小集）**：区域尺寸 / 每个 view 的 `collapsed` / 堆叠顺序 / 哪些 view 在屏上；两份 key（**per-window** 布局、**per-workspace** 展开项），用 DSH `client-store` 的 `persist`。注意力栈与 recall 历史**不存**。
  - key **带版本**：恢复时不校验形状，形状变了就得换 key。
  - **编排的默认放置只填空缺**——否则每次激活都把视图拖回出厂位，"持久化"自我撤销。
  - 边界：localStorage 是 per-origin ⇒ 同源两个 tab 共用一份状态；**per-workspace 那半仍未做**。
- **通道就是 chat**（James 2026-09-19）：不单独做"异步留言"的机制或视图。人和 agent 通过 chat 说话，**chat 本身是松耦合的**——谁不在都不阻塞，回来看会话记录即可。⇒ §4 里"异步通道"那组选项作废。
- **工作区以磁盘为准**（James 2026-09-19）：打开自动保存（切焦点或延时写盘），人和 agent 读写同一份文件；**不做**缓冲区级同步；反向那条（agent 改文件 → 人的编辑器）接受 VS Code 既有行为（没脏就重载，脏了就提示冲突）。代价是没有"未保存"这个状态、写盘更频繁。
- **打开的文件集合不给 agent**（James 2026-09-19）：agent 要知道人在看什么，靠人自己说，或者自己去看工作区和 git；不做"把人的视图状态同步给 agent"这条路。

### 3.7 生态与能力

- **agent / chat 侧归 DSH**（James 2026-09-18）：VS Code 自带的这一层**不作为 prac 的 agent 侧**——`contrib/chat/**`（chat 循环、participants/"agents"、会话、工具注册表与内置工具如 `reviewPlanTool` / `runSubagentTool` / `setArtifactsTool`）、`contrib/mcp` 的客户端、`platform/agentHost/**`（把 copilot / claude / codex 当被托管进程）都不进；**agent 的循环、工具、会话、模型、规划与评审都在 DSH**，我们从 VS Code 取的是 **IDE 能力**（编辑、语言特性、诊断、终端、任务、调试、VS Code 扩展生态）与 **UI 组件**。
  - 直接代价：**VS Code 扩展注册的 LM tools**（`contributes.languageModelTools` / `lm.registerTool`）我们拿不到——要用就得再实现一遍它的工具注册表与 `$invokeTool` 通道，等于把 agent 侧搬过来。⇒ 生态里对 agent 真正开放的接口收窄成两条：**MCP**（工具协议）与**文件定制**（`SKILL.md` / `*.instructions.md` / `AGENTS.md`）。
  - 但"不用"不等于"不存在"：Copilot 是**VS Code 内建扩展**（它声明 `chatParticipants` / `languageModelTools` / `mcpServerDefinitionProviders` / `chatSessions` / `chatPromptFiles` / `chatSkills`），会随扩展宿主一起活（见 §4）。
- **MCP 客户端 DSH 自己起**（James 2026-09-19）：只复用 VS Code 这边的 **server 定义来源**（扩展声明点 + 工作区配置），不复用它的 `contrib/mcp` 客户端。
- **文件定制不共源**（James 2026-09-19）：DSH 用自己的 skill / 上下文格式，不去读 VS Code 的 `SKILL.md` / `*.instructions.md` / `AGENTS.md`。
- **VS Code 的 chat 视图先留着不显示**（James 2026-09-19）：不禁掉它，也不在 prac 的界面里露出它的 chat；它声明的 MCP server 定义仍然在池子里（R13 要读的那些）。代价是树里确实多一个 agent 在跑。
- **扩展基座 = 完整 `server` 目标**（`--target server`，**必须带 `--nls`**），host 与 code server 都指向它。验收判据 = **一个 Tier 2 VS Code 扩展真的激活，且它的 UI 贡献出现在 prac 的 view 目录 / 区域里**。
- **terminal 用 VS Code 的**（`server` 目标自带 PTY + shell integration + VS Code 扩展 API），它只是底栏里的一个 view；**agent 执行命令走 DSH 自己的 exec**，不与人那条终端共用。
  - 代价：agent 看不到人终端的输出，除非日后做桥。
  - 作废的是"纯 web 无 PTY ⇒ PTY 放 DSH host"——基座换成完整 `server` 目标后，它的前提消失了。

### 3.8 工程约定

- **命名**：prac 自己的词自洽，借来的词带来源。
- **客户端半边**用 TS + `vite-plus`（`vp pack`）；loader 外壳是**配置**（`pack` 数组每平面一条），不引 DSH 的 preset；产物不变量放 `run.tasks: check:client`；源码级自定义 lint 规则只能写在**根** `vite.config.ts`。
- **profile `prac-dev`**：三 bundle；prac 的包以 `link:` 挂。
- **断言分层**：机制断言进单测（`vp test`，vite-plus 内置的 vitest），**活体门只留真页面能证明的事实**；新增机制断言只进单测，要加活体门必须先写清"单测证明不了它"。
  - 代价（必须记住）：单测看不见"模型对了、渲染器没跟上"⇒ 每个能力在活体层**至少留一条渲染断言**，几何类多条并成一条漂移检查。
- **进度提交**：feature 分支 + `wip:` 提交（检查点打 tag）；**提交 ≠ 成果已定**，靠人判断的内容仍要人先看。
- **机器状态**：构建期与一次性的在仓库内（`.build/`，可整份删），**运行期状态跟随 XDG、在仓库外**（`$XDG_{DATA,STATE,CONFIG}_HOME/prac/code-server`）；工具缓存用系统默认。

### 3.9 已否决 / 已撤回的路线（"放弃了什么"）

| 原判断 | 为什么被否决 |
| --- | --- |
| workbench 当 shell、agent 当 part | 会得到**两个壳**（DSH 外壳 + workbench 各一套 sidebar/右栏） |
| 「frame 交给 grid 后可以删掉 `mountPartInto`/`movePartInto`」 | 方向错了：部件永远是被容纳的一方，host 机制保留 |
| 路线①：patch 经典 `Layout` | 要换掉的正是布局模型本身；路线① 只是跟 VS Code 的 grid 语义周旋 |
| 让 VS Code 的 grid 拥有 prac 的 frame（选项 a/c） | 会把关系倒过来；只借行为 |
| 「遮蔽 `root` 即可拥有拓扑」 | `ui-slots` 明文 DO NOT register；第二份注册会遮蔽整个 frame ⇒ 正规做法是注册进 `shell.overlay`（list 槽） |
| `?folder=` 自建导航 | 那是 VS Code 自带 standalone bootstrap 读的，我们的入口是 `create()`，没有那层 |
| 「重载会打散 DSH 壳」 | 对照实验证明是**当时补丁损坏**的后果；带 `?folder=` 全新加载 / in-app `location.href='/'` / `openWorkspaceFolder` 三条路径 frame 全在 |
| 「`workspaceProvider.open()` 能打开文件夹」 | API 语义只是**构造 URL 开新窗口**；现明确返回 `false`（让调用方看见失败） |
| 「`create()` 的返回值是 workbench facade」 | 只返回 disposable；公开面是模块的 `commands` 命名空间 |
| 「`wsErrors: []` ⇒ WS 通了」 | 空错误可以意味着**什么都没发生**（当时 workbench 根本没启动） |
| 「派生路由（`codeServerRoutes()`）就修好了 segment 不一致」 | 只保证两侧一致地错；真正修法是给服务端 distro 的 `product.json` 盖章 |
| tsconfig `paths` 指向 checkout 作为覆盖开关 | 会把声明合并劈成两份（`keyof SlotMap` 有键、`register` 报 TS2769）⇒ 假错；机制正确的覆盖必须重定向**解析** |
| `dts: { only: true }` 出纯类型 | 不生效，还会覆盖 loader 产物 `client.js` ⇒ 用"类型再导出入口" |
| 「`intro` 会进产物」 | 被**静默丢弃**⇒ envelope 拼进 `banner`，并在 `bundle-client.mjs` 断言 |
| 「两个包到 `.build/` 的相对深度相同」 | 数 `../` 的想当然；失败形态是整片 404 ⇒ 改为逐级上溯"找" |
| `ctx.reflect.provide` 写法 | 文档拼写是 `ctx.provide`；行为不变 |
| 让补丁侧走全局 `__pracVsPartHost` / `__pracDeferVsParts` | 已被 S2 取代：走 `create()` 的 construction options（补丁本来就持有该服务） |
| 在机制里按 id 前缀判断这是不是 prac 的 view（`VS_VIEW_SOURCE`） | 机制不该认识来源词 ⇒ 按注册表成员判定 |

## 4. 开放问题

> 只列**还没做 / 还没定**的。已成决定的在 §3；设计为什么长这样见 [架构重做](../in-progress/2026-09-19-architecture.md)。
> **下一步（2026-09-21 之后）**：语言那条链（下面第 3 条）**已经做通**；它的两组后续——更多VS Code 内建扩展、MCP 定义接线——**都搁置**（James 2026-09-21）。插件族的划分**已撤销**（见"需要 James 裁"第 1 条）⇒ 眼下真正待决的是**扩展贡献的 view 怎么进 prac 的界面**（下面第 4 条）。

### 与目标架构的差距

> 对照 [docs/architecture.md](../../../docs/architecture.md)（面向目标的设计）。完成的部分已从这张表里移走。

| #   | 目标                                                     | 现状                                                                    |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| 3   | **VS Code 的 MCP server 定义接给 DSH 的 MCP 客户端**     | 未接（**搁置**，James 2026-09-21）                                      |
| 4   | **IDE 面都按 view 进来**                                 | 编辑器、侧栏已按 view；其余 IDE 面未接                                   |
| 5   | **两半之间走 DSH 的线**                                  | 现在是透传（`/prac-vscode` 静态 + VS Code 自己的 WS/HTTP 原样转发）      |
| 6   | **工作区以磁盘为准**                                     | 验证门故意关着自动保存；真实 rig 的行为未定                             |
| 7   | ~~**VS Code 侧是*一组*DSH 插件**~~（族怎么分**已撤销**，见"需要 James 裁"第 1 条） | 不成立：要的不是给插件分 server / client 侧，而是**扩展贡献的 view 能上屏** ⇒ 回到第 4 条 |

> 已经达成、不再列入差距的两条：**扩展宿主归主干**（主干自己连一条 ExtensionHost 连接、不依赖页面；UI 那条按上游每页一个，是设计选择）、**语言服务器经 `ctx.lsp` 的一个 provider 进来**（css VS Code 内建扩展，四道门已过）。

### 需要 James 裁

1. **插件族的划分 —— 已撤销**（James 2026-09-21）：**不需要区分哪个 DSH 插件算 server 侧、哪个算 client 侧**；要的是**VS Code 扩展贡献的 view 能上屏**。于是"族怎么分"这个问题不成立，真正的待办回到下面第 4 条（视图的数据）。
2. **阶段二**（决策空间 / 以审决策为主界面）：保持搁置；重新进入主线需要重新裁决。展开见 [2026-09-09-c2-decision-space.md](../proposed/2026-09-09-c2-decision-space.md)。
3. **高级形态（container / part）什么时候真的需要**：现在是按视图组合就够。

### 新要求（James 2026-09-21）

> 与"插件族"无关，是针对**给工作区装什么**这件事。

- **按工作区配置装哪些 VS Code 扩展（最好也能按 agent 配）**：**用 VS Code 自己的按工作区启用/禁用，不另造配置机制**（James 2026-09-21）。**两个消费者在两种形态里，状态各归各家**（James）：**UI 走 web**（启停状态在浏览器 IndexedDB 里；`web.main.ts:613-614` 无 remote 分支），VS Code 自己管它的宿主，我们不动；**agent 不是 web、是服务端消费者**，它的"装什么"要由**服务端的事实**决定 ⇒ 两边不互相镜像、也不为了统一去发明东西。**要接受的不一致**：UI 里禁用的扩展，agent 仍会加载（web 形态的必然；桌面/远程形态相反）。**agent 侧那份记录是"我们的配置"**（James 2026-09-21 定）：它是一份"**应该**装什么"的决定、人和 agent 可改可审 ⇒ 落 **`$XDG_CONFIG_HOME/prac/…`**（**config**，不是 state——prac 的运行时状态跟随 XDG，且**不挂 DSH 的家**：`~/.dsh` 是单一根、不分 XDG）。**没有记录时按全局那份**（= 装着、且没被全局禁用）——**这是 VS Code 自己的语义，不是我自造的三选一**（上游有序算：工作区 `enabled` → 工作区 `disabled` → 全局 `disabled` → 否则 `EnabledGlobally`，`extensionEnablementService.ts:634-661`）。**这份名单由 prac 自己维护（James 2026-09-21 定）**，且**与 UI 分离、但模型同构**（他的原话："继续分离，但 agent 的配置模式要和 UI 同构"）：文件是我们的两份——全局层 `$XDG_CONFIG_HOME/prac/settings.json`、工作区层 `<workspace>/.agent/prac/settings.json`（`.vscode/settings.json` 的对位）；同构在作用域 / JSONC 格式 / key 用上游标识符 / 优先级四件事上照 VS Code 的模型。**已实现**：挂在扩展宿主 init data 的 `myExtensions` 上（禁用的扩展仍在 `allExtensions` 里，只是永不激活），**并且桥进宿主**——两个文件按配置模型自己的层（`userRemote` / `workspace`）喂进去，宿主里的 VS Code 用 `workspace.getConfiguration` 直接读（James：「不能桥接进 vscode，让 vscode 直接读吗？只是区分 agent 和 UI 使用不同的配置源」）。**谁写：已定（James 2026-09-21）——先手工维护**（agent 的工具以后再说）。**按 agent 仍卡在 seam**（入参无会话标识）。详见 [docs/architecture.md](../../../docs/architecture.md) §7 #4。

### 已定方向、尚未做

4. **扩展贡献的 view**（**前提已改**：原来记的"tree view 没数据"是过时的，2026-09-21 核实**树视图本来就通**——挂 cSpell 的 `cSpellIssuesViewByFile` 得到的是扩展自己给的 `No issues found.`）。剩下的真缺口是：① **webview 视图**（`type=webview`，body 完全空，我们没接这条路）；② **没编译出来的内建扩展**（`references-view` / `npm` / `emmet`… 激活失败 ⇒ 视图无数据）。**"哪几个视图要进 prac 的界面"也还没定**——第一优先的排序要不要按新事实调整，待 James。
5. **frame 批次**：还差 `center` 的 tab（需要 VS Code 侧的 `editor(file)`）；持久化的 **per-workspace 那半**未做。堆叠与底栏还缺：拖拽排序、view 间 sash 调尺寸、底栏开合入口。
6. **自动保存打开之后，验证门怎么调**：那几条"文件保持不动"的断言是靠故意关掉 autoSave 才稳的（`verify-file` 最近一次 33/33 直接绿、与旧注意不一致，待查）。
7. **扩展安装的正当路径**：等 terminal 落地（它提供 `VSCODE_IPC_HOOK_CLI`）后用 `server-cli --install-extension` 正规安装；在那之前不装用户 VS Code 扩展（扩展目录现在由 `fs.watch` 接住，装了就能用）。
8. **sidebar / panel / statusbar 的映射**：还欠被 stub 掉的 layout 语义（显隐 / zen / centered / floating / 多窗口）。

### 仍然开放（工程与生态）

9. **契约写多遍**：view id 仍是 **6 处**字面量、`/prac-vscode` 仍是两处；**共享常量模块的落点与依赖方向未定**。
10. **VS Code 内建扩展**：挡在 `extensions/ipynb` 的 typecheck，所以 git / search / emmet 这些**内建**扩展在服务端还不可用——不影响"生态是否可用"（VS Code 市场扩展已走通）；css 那一个是单独定向编译出来的。
11. **机制正确的 checkout 覆盖开关**（重定向解析，而不是文件路径）：未做。
12. **多窗口 / 多标签页**：搁置（见 [`docs/architecture.md`](../../../docs/architecture.md) §7 #6）。

## Related

- [2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)：概念边界与命名的决定 + 执行（Step A/B、命名收束、lib 抽出）。
- [../in-progress/2026-09-19-architecture.md](../in-progress/2026-09-19-architecture.md)：从需求重做的架构（需求清单、推导、旧设计哪些留着哪些作废、本次范围）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：面向目标的设计（这一版）。
- [../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md](../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md)：prac 的定位与开发工作流模型。
- [../../../docs/vscode.md](../../../docs/vscode.md)：VS Code 自身的结构（两半与主线程、平台服务层、extHost 协议与载体）；DSH 那半在 [../../../docs/dsh.md](../../../docs/dsh.md)。
