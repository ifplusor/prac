---
status: in-progress
---

# Agent Note: prac 的界面形态 —— VS Code × DSH 融合

> 这是这项工作的 **umbrella**：主线定义、需求约束、决定（含被否决的路线）、开放问题。
> **依据**（里程碑与工作记录、现在的形态快照、已核实事实、踩坑、验证元教训）在 [工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md)——2026-09-17 从本 note 拆出，那时 5.7 万字符里 79% 是依据、决定只占 16%。**它不是 note**（没有状态轴、不签字）。
> 步骤 note：[2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)（概念边界与命名，实现已完成，待签字）；[../abandoned/2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)（把能力拆散带入 prac，方案待裁）；[../abandoned/2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)（两半之间的通信层，设计待裁——四项）；[../proposed/2026-09-19-architecture.md](../proposed/2026-09-19-architecture.md)（**从需求出发重做架构**：需求清单 + 推导 + 能力路由表 + 待裁，取代了旧设计）。
> 口径（**§3.8 的断言分层之后**）：**vendor 侧集成门**写作 **14/14 · 28/28 · 9/9 · 6/6 · 7/7 · 33/33**（layout · views · focus · regions · view · file）；第六门 `verify-extension` 是**条件门**（装了扩展才跑 5 项，没装时明确 `SKIPPED`——SKIP 不是通过）；**prac 侧活体门**写作 `verify:stack 6/6 · verify:bottom 6/6 · verify:persistence 6/6 · verify:split 11/11`；所有 part 计数一律 **8/8**；**单测**写作 `pnpm test`。

## 1. 这个工作是什么（主线定义）

1. **（2026-09-09）** 把 VS Code 与 DSH 结合成**一个**形态：prac 的界面 = agent 与 IDE **深融进一套 UI**，不是两套并列。保留**完整 IDE 能力与扩展生态**（Tier 2：语言包、GitLens 等 UI 扩展），**不要 VS Code 的布局**；以 agent 为中心，**IDE 是可按需下潜的重工具**。
2. **（2026-09-15）** **不是自定义 workbench，而是把基础能力拆散后带入 prac**：把 VS Code 的 **UI 层拆散**渲染进 DSH；**能力层**（如诊断）也要**暴露给 agent**；prac 同时利用 **VS Code 与 DSH 两方生态**。
   ⚠️ **（2026-09-19）这一条的三个前提都被重做**：见 [重新规划](../proposed/2026-09-19-architecture.md)——"能力面驱动 UI 组件"不再作为主轴、"UI 层拆散成组件"降为可选手段、诊断不是 agent 的一等能力（详见那篇 §4）。**下面 §3/§4 的内容按它的结论重读**，定案后重写。

**阶段切换**：此前在讨论 prac 的目标/理念，并以具体任务体验工作流（C1、C2）；进行到 C2 时 James 叫停，转入融合形态本身。叫停理由原文只有「我发现我们不应该再继续了」，推断是优先级——**待确认**。本工作**不欠**阶段二的那些机制（决策空间 / 以审决策为主界面）；它们要重新进入主线，需 James 重新裁决。

## 2. 需求约束（推导 UI 形态的前提）

### ① 协作模式（James 述）

- **共享工作空间 + 结对**：工作空间是 agent 与人**共有**的。流程：人提出想法/任务 → 两人在**一块白板（如 notes）**上讨论（细化、澄清目标、设计方案与计划）→ agent 实施（加工工作空间内容或把成果放回）→ 人旁观、可**打断**提醒纠偏、也会在 agent 需要时出现帮它操作 → review。变体：放手让 agent 自主完成一系列工作，或**叫停它自己上**。
- **白板与共识重要**；**保留工作记录、按需回顾**是更大的共识。
- **两个并行工作者、异步交流**：不共享同一个「当前阶段」⇒ **不是模式机**：没有「商定 / 实施 / 接管」这种要声明的状态。**谁在驱动是事实，不是状态**；**打断 = 说话 + 一个「停」**。
- **UI 是注意力的跟随器**：关注什么就把它拿到中间；换焦点要随手自然，并且要有**返回栈**。
- 三种角色（白板/记录、工件、对话）**不是三个固定格子**；**白板本身就是工作区里的文档**（notes 是文件）⇒ 白板与工件是同一种东西、只是角色不同 ⇒ 不需要两个面板。**恒在的是「环境」，不是「模式」**：导航（工作区/记录树）、**通道**（异步留言：你说的话等我看到）、**我在改什么**。
- 主场景 = **单工作区下持续、重度工作**；快速切换 / 同时多工作区更好，但不是主场景。

### ② 布局规格（James 定）

若 DSH 的布局能力有缺陷，**就基于它做我们自己的布局**（像改造 VS Code 一样）：主操作台 = 注意力焦点，四周是辅助操作面板；交流时 **chat 是焦点**，审阅计划/方案时**白板是焦点**且 chat 在一边随时可发消息，审阅工作区内容时**编辑器是焦点**、chat 在一边、资源浏览器在另一边；主操作台**可分栏**；**terminal 随时调出**；各窗口/视图**按需显示**、能方便隐藏收起与快速调出。

## 3. 决定（现在的设计为什么长这样）

> 这一节只写**当下的立场**：决定了什么、为什么、放弃了什么。**不记编年**——哪天裁的、当时先想到什么、被纠正过什么、落地时验了多少，都在[工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md)：那里**原样保留着旧的决定台账**，历史引用 `决定 N` 按它解析（编号不再新增）。
> ⚠️ **2026-09-19：「放弃当前的架构设计，从需求出发，从头设计架构」**（James）。**重做中**的设计见 [proposed/2026-09-19-architecture.md](../proposed/2026-09-19-architecture.md)；它列了哪几条旧决定仍有效、哪几条被扔（§4）。定案后这一节与 §4 按它重写。
> `docs/architecture.md` 是**面向目标**的设计（要建成什么，**现已加"被取代"横幅**）；这一节是**已经定下的**那些（为什么是现在这个形状），差距与待裁项在 §4。

### 3.1 总纲：两端结构与主干

- **prac 是 CS/BS 两端结构，主干是 DSH**。看架构**先分 client / server**，不是先分 DSH / VS Code——两个系统各自都跨在线上。
- **DSH 的扩展方式就是插件**：同一棵树、同一地址空间，耦合是 in-process 的 `inject`。**"扩展宿主"是 VS Code 的概念，不能带到 DSH 上**——两者是不同的机制，不是一个角色的两种形状。
- **VS Code 是主干上的一族插件**（不是"被嵌进来的第三方 app 加一层接缝"）：server 半边拥有它的进程与能力，client 半边把 UI 贡献进 frame；bridge / part host / `prac-vscode-embed` 是**这族插件的内部实现**。
- **三层各归其位**：`vendor/vscode` = 引入的上游源码树 + 我们的 patch；`vendor/vscode-embed` = 在其上封装的 **lib**（可利用、不绑定 prac，**只给机制、不背政策**）；**政策**（谁放哪、何时启动、哪个 view 用哪个 part、能力怎么给 agent、code server 的生命周期）全在插件层。

### 3.2 容纳与单位

- **DSH 页是 shell**，VS Code 的 parts 挂进 DSH 的**真**布局 region（不 island 化）。
- **部件永远是被容纳的一方**：经 host 挂进来，**不是搬过来**。
- **容纳单位 = `view`**：`prac.view` 目录里同时住着 `dsh:*` 与 `vscode:*` 两方 view，它们已经是同一种东西；**container 是可选分组**、**part 是可选的高级形态**（整块标准 IDE 区域），都不是 prac 组合的单位。
  - 为什么：用 part 当单位等于让 prac 说 workbench 的编排词汇，并继承它"单实例 / 只能搬"的约束。

### 3.3 框架归属与分层

- **frame 由 `ui-layout` 拥有，只借 VS Code 的行为**（视图契约、`GridDescriptor` 的树形摆放、收起记宽、maximize、layout policy 的写法）；**不让它的 grid 拥有 prac 的 frame**。
- **机制与组合分层**：机制（`ui-layout`）/ 编排（`web-app`）/ VS Code 侧（vendor + 两个 prac 行）。**机制层不含任何具体视图名与默认落位**。
- **code server 的进程归主干**：`prac-host-vscode` 自己 spawn 它（`out-vscode-reh/server-main.js`，不用 `--folder`——工作区由 client 的 boot 决定），端口取空闲、等 `/version` 就绪、随插件 dispose 收掉；环境变量（`PRAC_CODE_SERVER_URL` / `_ENTRY` / `_PORT` / `_PATH`）是逃生口。页面不再拥有它。
- **两个服务主次分明**：`ctx.layout` 是**兼容 shim**（只服务 `ui-workspace` / `ui-sidebar` / `ui-sidebar-right` 用的 5 个方法，可整体删除）；`ctx.pracLayout` 是 prac 机制（含 `bindRoles`），机制**不知道谁是 sidebar**。

### 3.4 对上游的姿态

- **不 fork DSH**：替换它的布局走它自己的组装层（bundle patch：`insert` / `disabled`，`disabled` 必须排在 `insert` **之后**）。
- **不引入第三方改造**（`monaco-vscode-api` / Theia），**也不把源码树拷进项目**：直接对官方 Code - OSS pin + 小而可审的 patch。
- **布局自己重做，但只做便宜的那层**：parts 编排 + layout service 我们 own；**service 层与扩展渲染不拆**（拆 ≈ `monaco-vscode-api` 级改造，等于放弃"上游可控"）。这是"保留完整生态"的落点。
- 做法：自写 workbench + layout service（不走 patch 经典 `Layout` 那条路），`IWorkbenchLayoutService` 按 prac 需要实现，模板 = `src/vs/sessions/`；补丁的目标是把 workbench **从 app 变成 library**。

### 3.5 区域与编辑面

- **区域的形态**：常驻区（`sidebar` / `rightbar`）不分栏、但**都可堆叠**（可折叠 header、排序、尺寸记忆）；**`stage` 的分栏必须带视图**（对齐 VS Code 的 editor group）；新增**常驻底栏**（`bottom`，默认收起，放 terminal / 输出 / 问题）；`stage` 支持**任意方向**分栏（上下左右、可嵌套）——**任何方向都造不出空 region**。
- **对话是普通 view**：`dsh:main:conversation` 可被编排放到任意 region（默认侧边），注意力可把它提升到中间；`selectPanel` 只把**新选中的**视图放进编排给它的 region，不再"替换当前 main 视图所在的那个 region"。
- **`stage` 提供 tab 与分栏，VS Code 侧提供"单个 file view"**：prac 的"编辑器" = **一个文件的编辑面**（一个 view），**不是 editor part / editor group**；tab 与分栏由 `stage` 提供（**frame 级标签页**，在 stage 内），frame 本身仍不认识"编辑器组"。
  - 为什么：用 VS Code 的 editor part（自带 tab 条与 group 模型），chat 与 editor 就无法在 stage 里自由并排。
  - 代价：`workbench.parts.editor` 现在是**过渡形态**；lib 的 editor 句柄应定义成 `editor(file) → view`。

### 3.6 工作区与状态

- **工作区是界面的一等关系**：单窗口 + **切换即重载**；**多窗口同一工作区要支持**；UI 上有**专门的工作区选择入口**（精确切换，也作初始落地页）；**未激活工作区**时 DSH 壳仍在、IDE 侧不启动；per-window 与 per-workspace 的 UI 状态分开，**多窗口同一工作区各一份**；**对话在创建时绑定工作区**。
- **持久化（最小集）**：区域尺寸 / 每个 view 的 `collapsed` / 堆叠顺序 / 哪些 view 在屏上；两份 key（**per-window** 布局、**per-workspace** 展开项），用 DSH `client-store` 的 `persist`。注意力栈与 recall 历史**不存**。
  - key **带版本**：恢复时不校验形状，形状变了就得换 key。
  - **编排的默认放置只填空缺**——否则每次激活都把视图拖回出厂位，"持久化"自我撤销。
  - 边界：localStorage 是 per-origin ⇒ 同源两个 tab 共用一份状态；**per-workspace 那半仍未做**。

### 3.7 生态与能力

- **agent / chat 面归 DSH**（James 2026-09-18）：VS Code 自带的这一层**不作为 prac 的 agent 面**——`contrib/chat/**`（chat 循环、participants/"agents"、会话、工具注册表与内置工具如 `reviewPlanTool` / `runSubagentTool` / `setArtifactsTool`）、`contrib/mcp` 的客户端、`platform/agentHost/**`（把 copilot / claude / codex 当被托管进程）都不进；**agent 的循环、工具、会话、模型、规划与评审都在 DSH**，我们从 VS Code 取的是 **IDE 能力**（编辑、语言特性、诊断、终端、任务、调试、扩展生态）与 **UI 组件**。
  - 直接代价：**扩展注册的 LM tools**（`contributes.languageModelTools` / `lm.registerTool`）我们拿不到——要用就得再实现一遍它的工具注册表与 `$invokeTool` 通道，等于把 agent 面搬过来。⇒ 生态里对 agent 真正开放的接口收窄成两条：**MCP**（工具协议）与**文件定制**（`SKILL.md` / `*.instructions.md` / `AGENTS.md`）。
  - 但"不用"不等于"不存在"：Copilot 是**内建扩展**（它声明 `chatParticipants` / `languageModelTools` / `mcpServerDefinitionProviders` / `chatSessions` / `chatPromptFiles` / `chatSkills`），会随扩展宿主一起活（见 §4）。
- **扩展基座 = 完整 `server` 目标**（`--target server`，**必须带 `--nls`**），host 与 code server 都指向它。验收判据 = **一个 Tier 2 扩展真的激活，且它的 UI 贡献出现在 prac 的 view 目录 / 区域里**。
- **terminal 用 VS Code 的**（`server` 目标自带 PTY + shell integration + 扩展 API），它只是底栏里的一个 view；**agent 执行命令走 DSH 自己的 exec**，不与人那条终端共用。
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
| 「遮蔽 `root` 即可拥有拓扑」 | `ui-slots` 明文 DO NOT register；第二份注册会遮蔽整个 frame ⇒ 正规座位是 `shell.overlay`（list 槽） |
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
| 在机制里按 id 前缀判座位（`VS_VIEW_SOURCE`） | 机制不该认识来源词 ⇒ 按注册表成员判定 |

## 4. 开放问题

> 只列**还没定**的：要什么、有哪些选项、代价是什么。已成决定的在 §3；编年、当时的数字、"怎么收敛到现在的"在工作记录。
> **下一步顺序（建议，未裁）**：frame 批次剩下的（`stage` 的 tab、持久化的 per-workspace 那半）→ 能力面（含上下文入）→ 与目标架构的那几处差距。

### 与目标架构的差距（待收束）

> 对照 [docs/architecture.md](../../../docs/architecture.md)（**面向目标**的设计）：这段距离就是待设计的工作（出处见 §3.1）。

| #   | 目标                                                                       | 现状                                                                                                           |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **主干（server）是组装与权威，页面是视图**                                 | 组合确实是主干的（profile / bundle patch / loader 行），但 **UI 组装、能力面的唯一实现**都在页面               |
| 2   | **VS Code 侧是*一组*插件**（基于 lib 构建，server 侧一族 + client 侧一族） | 只有两个包被当成"客户端机制 + host 策略"，其余座位各自成包，族的结构没有被表述                                 |
| 3   | **一个主干**                                                               | **两个服务端**（DSH 一个、code server 一个；后者已由主干起停，但两者仍是两份进程、两套状态）                   |
| 4   | **两半之间的通信层基于 DSH 的架构重新设计**                                | 现在是**透传**：`/prac-vscode` 静态服务 + 把 VS Code 自己的 Management/ExtensionHost WS 原样转发到 code server |
| 5   | **client 侧提供 UI 组件、server 侧（code server）提供 IDE 基础能力**       | client 侧嵌的是**整个 workbench app**（自带完整 service 图、状态与协议），能力面也长在 client 侧               |

### 需要 James 裁

1. **理想形态是否确认**：`kernel / views / capabilities` 三层，以及"view 是单位"之上的服务形态（§3.2 只定了单位）——方案与代价见 09-15 note。
2. **两套 server 统一**的路线：先"共存 + 共享 workspace"，还是直接"DSH 跑进 code server"（§3.7 只定了先换基座）。
3. **阶段二**（决策空间 / 以审决策为主界面）：保持 `proposed`，不表态；当时叫停的理由也仍待确认。
4. **高级形态（container / part）什么时候真的需要**：逐个 view 组合，还是"把整块 sidebar 原样搬来"。
5. **异步通道**：已定"先不做"，**形态未裁**（选项：最小标记 + 双向服务 / 完整异步线程 / 复用 chat 的留言模式）。
6. **VS Code 自带的 agent 面在 prac 里怎么处理**（§3.7 已定 agent/chat 归 DSH，这一条问的是它**在我们树里的去处**）：Copilot 是内建扩展、会激活。选项：① 明确禁掉（`disabled`，不给它 `myExtensions`）；② 留着但界面不暴露（人想用时它还在）；③ 当"别人家的 agent"共存——这条与"chat 归 DSH"冲突（界面上会出现两个对话），除非只在某些座位里允许。
7. **MCP 的客户端归谁**：agent 归 DSH ⇒ 工具接入理应由 DSH 自己的 MCP 客户端承担（VS Code 侧那套有 registry / gateway / sandbox / sampling，还会从 Claude Desktop / Cursor / Windsurf 的配置导入定义）。选项：① DSH 起客户端，只**复用** VS Code 侧的 server 定义来源（扩展贡献点 + 工作区配置）；② 用 VS Code 的 MCP 客户端，把它当能力面暴露给 DSH；③ 两边各起一条。代价与重复连接的问题要验。
8. **文件定制是否共源**：`SKILL.md` / `*.instructions.md` / `AGENTS.md` 是纯文件，DSH 的 skill / 上下文机制可以读同一份。选项：① 共源（一个真实源，代价是跟随上游格式漂移）；② 只共 `AGENTS.md` 这类"仓库事实"，DSH 自己的 skill 格式独立；③ 各用各的。

### 已定方向、尚未做

6. **能力面（capabilities）**（含上下文入）：方向上已定（view 为单位、能力面要暴露给 agent），但**目前没有任何实体**——能力清单与 settled / provenance / 分页语义见 09-15 note。
7. **frame 批次**：还差 `stage` 的 tab（§3.5 的 frame 级标签页，需要 VS Code 侧的 `editor(file)`）；持久化（§3.6）的 **per-workspace 那半**未做。堆叠与底栏还缺：拖拽排序、view 间 sash 调尺寸、底栏的开合入口（现在只有 `setCollapsed`）。
8. **扩展视图的"数据"**：`mountViewInto` 能让扩展贡献的视图出 pane、标题与像素，但 **tree view 的 body 是 `no data provider registered`**——`ViewPane.setVisible(true)` 不够。两条候选路：把视图登记进 `IViewsService` 的可见性/容器模型，或改走"container 作为高级形态"（§3.2 / §3.5 已允许）。
9. **扩展安装的正当路径**：等 §3.7 的 terminal 落地（它提供 `VSCODE_IPC_HOOK_CLI`）后，用 `server-cli --install-extension` 正规安装；在那之前不装用户扩展。
10. **sidebar / panel / statusbar 的映射**：目前只落了 sidebar + 对话 + 编辑器 + 环境条 / 调出面；还欠被 stub 掉的 layout 语义（显隐 / zen / centered / floating / 多窗口）。

### 仍然开放（工程与生态）

11. **契约写多遍**：view id 仍是 **6 处**字面量、`/prac-vscode` 仍是 Node/浏览器**两处**；**共享常量模块的落点与依赖方向未定**（Step B 第二部分）。`dsh-types --compare` 已覆盖"类型是否漂移"。
12. **内建扩展**：挡在 `extensions/ipynb` 的 typecheck（`npm run build-fast-extensions`），所以 git / search / emmet 这些**内建**扩展在服务端还不可用——这不影响"生态是否可用"（市场扩展已走通）。
13. **机制正确的 checkout 覆盖开关**（重定向解析，而不是文件路径）：未做。

## Related

- [2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)：概念边界与命名的决定 + 执行（Step A/B、命名收束、lib 抽出）。
- [../abandoned/2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)：把能力拆散带入 prac 的理想形态与第一步方案。
- [../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md](../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md)：prac 的定位与开发工作流模型。
- [../../../docs/vscode.md](../../../docs/vscode.md)：VS Code 自身的结构（两半与主线程、平台服务层、extHost 协议与载体）；DSH 那半在 [../../../docs/dsh.md](../../../docs/dsh.md)。
