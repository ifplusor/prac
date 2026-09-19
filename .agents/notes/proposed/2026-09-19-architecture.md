---
status: proposed
---

# Agent Note: 架构（从需求出发重做）

> **由来**：2026-09-19 James ——「合并相关文档，放弃当前的架构设计，从需求出发，从头设计架构」。
> **这篇取代**：`2026-09-19-integration-replan.md`（同一件事的前半，已并入本文并把文件改名为本文）；[2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)（broker 设计）与 [2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)（能力拆散带入）作为**计划**已被本文取代（移入 `abandoned/`；内容不作废——broker 那条降为本文的 P1）。
> 目标架构的参考文档 `docs/architecture.md` 在本文定案后整体重写；两个系统的**内部结构事实**（[`docs/dsh.md`](../../../docs/dsh.md) / [`docs/vscode.md`](../../../docs/vscode.md)）不受影响。

## 1. 需求（设计只从这些出发）

**目的与形态**

| #   | 需求                                                                                                                                                                                                                                                                | 出处                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| R1  | **prac 有两副面孔**：**UI 面向人**——① 人与 agent 交互的界面、② 辅助人工作的 **IDE 界面**；**另一方向 prac 是 agent 的运行时**——agent 跑在 prac 里（harness：loop、工具、上下文、审批、沙箱、会话与持久化）。不是两套并列的产品；**IDE 是可按需下潜的重工具**                                                                                                                                                                          | **James 2026-09-19**（细化 umbrella §1.1） |
| R2  | **协作模式**：共享工作区 + 结对；**白板就是工作区里的文件**（notes）；agent 实施、人旁观、可打断、可接管；**不是模式机**（谁在驱动是事实，不是状态）；UI 是**注意力的跟随器**且有返回栈；恒在的是环境（导航 / 通道 / 我在改什么）；主场景 = 单工作区持续重度工作 | umbrella §2①        |
| R3  | **布局规格**：主操作台 = 注意力焦点，四周辅助面板；chat / 白板 / 编辑器轮流当焦点、其余在侧；主操作台可分栏；terminal 随时调出；视图按需显隐                                                                                                                           | umbrella §2②        |
| R4  | **保留完整的 IDE 能力与扩展生态**（含 Tier 2 扩展），但**不要 VS Code 的布局**                                                                                                                                                                                       | umbrella §1.1       |
| R5  | **主干是 DSH**：组合、状态、进程、生命周期归它；DSH 的扩展方式就是插件（同一地址空间、in-process `inject`）；prac 自己的部分与 VS Code 都以插件挂在主干上                                                                                                             | James 2026-09-16    |
| R6  | **agent / chat 面归 DSH**：VS Code 的 chat / participants / 工具注册表 / 会话 / agentHost 都不进 prac 的 agent 面                                                                                                                                                     | James 2026-09-19    |
| R7  | **VS Code 按 prac 的两端切成两半**：code server = server 侧的 remote（IDE 基础能力）；web = client 侧（UI）                                                                                                                                                            | James 2026-09-16    |
| R8  | **两半之间的通信层基于 DSH 的架构重新设计**，不是把 VS Code 的传输透传过来                                                                                                                                                                                            | James 2026-09-16    |
| R9  | **不 fork 上游**：DSH 走它的组装层；VS Code 只 pin + patch + overlay，源码不进本仓                                                                                                                                                                                   | umbrella §1.3       |
| R10 | **三层各归其位**：`vendor/vscode`（上游 + patch）/ `vendor/vscode-embed`（lib，可利用不绑定 prac）/ 基于 lib 的 DSH 插件族（政策）                                                                                                                                   | James 2026-09-16    |
| R11 | **prac 不只有 VS Code 集成族**：frame / 编排 / 角色 / 注意力 / 持久化 + **agent 面（六件事）** + 从 DSH 继承的能力族                                                                                                                                                  | James 2026-09-16    |
| R12 | **VS Code 里最有价值的能力是 LSP**，要接进 DSH                                                                                                                                                                                                                        | James 2026-09-19    |
| R13 | agent 面归 DSH ⇒ 生态对 agent 开放的接口只剩 **MCP**（工具）与**文件定制**（`SKILL.md` / `*.instructions.md` / `AGENTS.md`）；扩展注册的 LM tools 拿不到                                                                                                              | R6 的推论（09-19 核实） |
| R14 | 运行期状态跟随 XDG、在仓库外；构建期状态在 `.build/`                                                                                                                                                                                                                | 已落地              |
| R15 | **不引第三方改造**（`monaco-vscode-api` / Theia 一类）                                                                                                                                                                                                               | umbrella §1.3       |

**agent 面（六件事）**＝决策优先、依据一等公民、可逆带检查点、审查是主界面、架构记忆、活的计划（`docs/philosophy.md`）。它归 DSH（R6 / R11），是**立身之本**，不是 IDE 的附属物。

**09-19 核实到的三条事实**（不是需求，但改了设计的取值）：① 诊断是**推-only 的有损缓存**（1000 条/文件截断、`modelVersionId` 无人消费、一半产在渲染器）；② 请求/响应那类能力（语言特性、命令）**由主线程发起**，而扩展可以经 `vscode.execute*Provider`（24 个）拿到它们；③ 上游本来就把"算在哪"与"呈现到哪"分开（装饰 / 状态栏 / 命令都由主线程代理）。细节见 [`docs/vscode.md`](../../../docs/vscode.md)。

## 2. 从需求推出的结构

### 2.1 两副面孔 × 一条主干、两端（R1 / R5 / R7 / R8）

**两副面孔**（R1 的直接推论，也是后面所有划分的判据）：

- **给人**：交互界面（人 ↔ agent：对话、计划与审阅、注意力与返回栈）与 **IDE 界面**（编辑器、问题、终端、SCM、搜索、资源）——都在 client，由 prac 编排；
- **给 agent**：**运行时**——harness、工具、上下文、审批、会话与持久化——在 server，由 DSH 提供；
- **同一份 IDE 能力服务两副面孔**：给人是**界面**（§2.4 第三档），给 agent 是**能力**（第一、二档，经 LSP / MCP / exec / 文件工具）。所以后面每条能力都要能回答"**它服务哪一副面孔**"。

- **两端**：client（页面）与 server（Node）。DSH 在两端都提供骨架（client：loader / 槽 / 服务注册表；server：Cordis 树 / 组装 / 进程 / agent loop），prac 自己的插件与 VS Code 的插件按所属端挂上去。
- **主干只有一个**：组合与状态归 DSH；**code server 是被主干起停的子进程**，不是第二个主干。
- **跨端的线只有三条**：服务调用（DSH remote，client 调 host 声明的方法）、事件与流（转发事件 + 流复用）、页面产物（HTTP 同源）。
- **VS Code 的 extHost 协议不跨这条线**（R8）：它属于 server 侧内部。

### 2.2 VS Code 的位置：一族插件，按端切两半（R7 / R10）

`vendor/vscode`（上游 + patch）→ `vendor/vscode-embed`（lib：启动、资产、宿主元素、命令面）→ 插件族：**server 半边**（拥有 code server 进程与政策：谁放哪、何时启动、能力怎么给 agent）+ **client 半边**（把编辑器与 IDE 面板贡献成 prac 的 view）。**不要 VS Code 的布局**（R4）：它的 workbench 布局不主导 prac 的 frame。

### 2.3 agent 面全在 DSH，连带三条界面后果（R6 / R11）

1. **人 ↔ agent 的交互界面是 prac 的一面（给人）**，它落在 DSH 的会话与工具之上（R1 + R6）：chat 视图、工具调用与审批、计划与审阅都由 prac 编排、由 DSH 供数据；**VS Code 的 chat 面不出现在 prac 的界面里**。
2. **白板就是文件**（R2）：notes 是工作区里的 markdown，人用 DSH 的文档视图看、agent 用文件工具读写 ⇒ 不需要第二套文档系统。
3. **树里会有"别人家的 agent"**：Copilot 是 VS Code 的**内建扩展**（声明了 `chatParticipants` / `languageModelTools` / `mcpServerDefinitionProviders` / `chatSessions` / `chatPromptFiles` / `chatSkills`），会随扩展宿主激活——**在我们 rig 里是否真的激活待测**。⇒ 必须显式决定它的去处（§5.7）。

### 2.4 IDE 能力分三档入 prac（R4 / R12）

| 档             | 内容                                                                             | 从哪来                                      | 给谁                                                               |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| **语义服务**   | hover / definition / references / symbols / code actions / 语义 token / 按需诊断 | **语言服务器**（扩展宿主里，或 DSH 直接起） | **agent 优先**（R12）；编辑器 UI 复用                              |
| **工作区动作** | 文件、搜索、git、任务、调试、终端                                                 | code server（VS Code 的 API 与进程）        | 人（界面）；agent 走 DSH 自己的 exec / 文件工具，**不与人那条终端共用** |
| **呈现**       | 编辑器控件、面板、装饰、状态栏、视图                                             | VS Code 的 client 半边                      | 人                                                                 |

**第三档不等于"扩展必须搬到 client"**：上游把"算在哪"与"呈现到哪"分开（`$trySetDecorations` / `StatusBar` / `$executeCommand` 都由主线程代理）⇒ 只要有一个主线程在，扩展可以在 server 侧跑而像素落在页面。这条**推翻了旧设计里"UI 组件必须在 client 侧"的强读法**（§4）。

### 2.5 生态对 agent 的三个接口（R13）

① **MCP**：扩展声明的 server 定义（`contributes.mcpServerDefinitionProviders`）、工作区配置、乃至别的工具（Claude Desktop / Cursor / Windsurf）的配置——**DSH 当客户端**（归属待裁，§5.4）；
② **文件定制**：`SKILL.md` / `*.instructions.md` / `AGENTS.md` 是纯文件，DSH 的 skill / 上下文机制可以直接读（是否共源待裁，§5.5）；
③ **扩展贡献的 UI**（视图 / 编辑器 / 状态栏）——给人用。

### 2.6 界面：frame 拥有布局，view 是单位（R3 / R4）

- frame 是 prac 自己的（区域树 / 分割 / 堆叠 / 折叠 / 底栏 / 视图目录 / 持久化），**机制层不认识任何具体视图名**；
- **座位由来源决定**：`dsh:*`（对话、计划、审阅、笔记、通道）与 `vscode:*`（编辑器、问题、终端、SCM、搜索、资源）同住一个 `prac.view` 目录；
- **注意力与返回栈是 frame 的能力**（R2），不是某个视图的。

### 2.7 共享工作区的真实条件：缓冲区 ↔ 磁盘（R1 / R2）★

结对与"人可接管"要求**人与 agent 看到同一份工作区**。今天这条有一个洞：**人未保存的缓冲区活在页面里**，而 agent 的文件工具读的是磁盘。⇒ 必须显式选一种：

- **① 磁盘即真源**：自动保存（焦点变化 / 延时）。便宜、语义简单；代价是失去"未保存"这个状态、频繁写盘（注意：我们的验证门为了别的目的**故意关掉了 autoSave**，真实 rig 要另定）。
- **② 缓冲区级同步**：页面 ↔ 主干的文档同步（谁持权威、冲突怎么判）。能力最强、成本最高。
- **③ 混合**：默认自动保存 + 显式 flush 点（交付 / 暂停 / 让 agent 读之前）。

**反向那条也要定**：agent 改文件 → 人的编辑器。VS Code 对磁盘外部改动有既有行为（未脏则重载、脏则冲突提示）——要么接受它，要么让 agent 的写入走编辑器（那就回到文档同步）。

### 2.8 状态与权威（R5 + 2.7）

| 状态                                                            | 归                        | 理由                                                           |
| --------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| 工作区文件                                                      | **磁盘**（§2.7）          | 人机共享的最小公倍                                             |
| DSH 会话 / 工具 / 审批 / 计划 / 注意力                          | DSH host                  | agent 面归 DSH（R6）                                           |
| code server 进程与 IDE 侧状态（扩展宿主、语言服务器、终端 PTY） | server（主干起停）        | R5                                                             |
| 编辑器视图状态（打开的文件、布局、选择、折叠）                  | client                    | 纯呈现；但**打开的文件集合**若要给 agent 看，要显式同步（§5.3） |
| 诊断 / 装饰 / 状态栏                                            | server 计算 + client 呈现 | 给 agent 的是**语义服务**，不是这份呈现缓存（§2.4）             |

### 2.9 生命周期与进程（R5 / R14）

code server：主干起停、空闲端口、随插件 dispose 收掉（**已落地**）。**扩展宿主归谁**取决于 LSP 那一步（§5.1）：今天它由页面发起 ⇒ **没有页面就没有扩展宿主，也就没有语言服务**；要让 agent 不依赖页面，就要让主干起一条自己的扩展宿主连接（P1）。页面刷新 / 断线的语义跟着这条选择走。

### 2.10 插件族与 lib（R10 / R11）

- `vendor/vscode`：上游 + 我们的 patch；`vendor/vscode-embed`：lib（**机制，不背政策**）。
- **server 半边插件**：路由、code server 起停、（若走 P1）agent 侧的扩展宿主连接与主线程面。
- **client 半边插件**：frame 与编排、`vscode:*` 座位、DSH 自己的视图（对话 / 计划 / 审阅 / 笔记 / 通道）。
- DSH 直接继承的能力族（tools / skill / goal / plan-mode / subagent / workflow）**不动**。

## 3. 能力路由表（设计的落点）

| 能力                                              | 提供者                              | 走哪条边                                       | 服务哪副面孔                  |
| ------------------------------------------------- | ----------------------------------- | ---------------------------------------------- | ----------------------------- |
| 人 ↔ agent 交互（对话、计划、审阅）               | DSH host 插件                       | DSH remote + 转发事件                          | **人**（界面）；agent 是同一份会话的运行时 |
| 白板 / 笔记 / 工作区文档                          | 工作区文件                          | 文件系统（§2.7）+ DSH 的文档视图               | 人（界面）+ agent（运行时读写同一份文件） |
| **语义服务（LSP）**                               | code server 的扩展宿主（语言服务器） | **待裁：P1 / P2 / P3（§5.1）**                 | **agent**（能力）优先；人（编辑器界面）复用 |
| 文件 / 搜索 / git / 任务 / 调试 / 终端            | code server                         | 页面内 UI；agent 走 DSH 自己的 exec / 文件工具 | 人（IDE 界面）+ agent（能力） |
| 诊断与 Problems                                   | 扩展宿主 + 渲染器侧生产者           | extHost 协议（server 侧内部）                  | **人**（IDE 界面；agent 拿语义服务而不是这份缓存） |
| 扩展贡献的视图                                    | 扩展宿主                            | 主线程 → prac 的桥 → 页面的 view               | **人**                        |
| **工具接入**                                      | 扩展声明的 MCP server / 工作区配置  | **MCP**（DSH 当客户端，归属待裁）              | **agent**（运行时）           |
| **知识与定制**                                    | `SKILL.md` / `*.instructions.md` / `AGENTS.md` | 文件（是否共源待裁）                  | **agent**（运行时装载）；人可读 |
| 编辑器与 IDE 面板                                 | `vendor/vscode-embed` + client 半边 | 页面内                                         | **人**                        |

## 4. 旧设计：留什么、扔什么

**留**：主干是 DSH；两端；VS Code 一族插件按端切两半；三层（vendor / lib / 插件族）；frame 拥有布局、**view 是单位**；code server 归主干起停；XDG；不 fork 上游；"agent 执行命令走 DSH 自己的 exec、不与人那条终端共用"。

**扔**（前提已不成立）：

1. **"能力面（capabilities）驱动 UI 组件"作为架构主轴**——它的两个消费者（UI 组件、agent）现在都不需要它（§2.3 / §2.4）；
2. **"把 VS Code 的 UI 层拆散成组件"作为目标形态**——降为个别座位的可选手段（§2.4 / §2.6）；
3. **"broker 扮演主线程"作为默认路径**——降为 LSP 路径里的一条（P1，§5.1）；
4. **"把已跑结果（诊断）当 agent 能力"**——它是给人看的呈现 + 有损缓存；
5. **VS Code 的 chat / participants / LM tools / 会话 / agentHost**（R6）；
6. **把 VS Code 的传输透传到页面**（R8；早已否，此处记为终态）。

## 5. 待裁

1. **LSP 走哪条路**（R12 的落点）：
   - **P1 我们当主线程**：主干连一条新的 ExtensionHost 连接，实现按需的最小面（三条初始化推送 + `ExtensionService` + `Errors` + **Documents** + 我们挑的 N 个 `$provide*`）。**无页面依赖、拿全生态**；代价 = 实现面 + 第二份激活上下文（两份 cSpell / 语言服务器）+ 跟随上游漂移。
   - **P2 页面扩展宿主 + 我们写扩展**：扩展里 `vscode.execute*Provider`（24 个）+ `commands`，经 **MCP** 回 DSH。零协议、约百行；**代价 = 要页面在**。
   - **P3 DSH 自己起语言服务器**：直接 spawn（LSP over stdio）。零 VS Code 依赖；代价 = 自己维护"哪个语言用哪个服务器 + 初始化参数 + 版本"，拿不到扩展独有的服务器。注意**内置 TS 支持不是 LSP**（自带 `tsserver` 与自有协议）。
   - **建议先跑探针 C（半天）**：DSH 起一个语言服务器、问一次 hover / definition。够用 ⇒ P1 降为"覆盖扩展独有服务器才做"；不够 ⇒ 再在 P2 / P1 之间选。
   - 硬前提（09-19 核实）：**文档模型必须由我们喂**——`HoverAdapter` 对 `getDocument()` 没有 undefined 守卫，末尾还会 `doc.getWordRangeAtPosition()`。⇒ 走 P1 就必须持有文本模型（不是为了编辑，而是每次语言特性都要一份活的 document + version）。
2. **共享工作区怎么保证**（§2.7 的三个选项）。
3. **打开的文件集合**要不要给 agent（"人在看什么"的最短路径，但要显式同步）。
4. **MCP 客户端归谁**（DSH 自己起 / 复用 VS Code 的 / 两边各起）。
5. **文件定制是否共源**。
6. **呈现从哪来**：整包 workbench（现状、能用）还是组件（旧目标）——现在这个问题只剩"人看的界面怎么做"这一层含义。
7. **VS Code 的 chat 面在 prac 里的去处**：禁掉 / 留着不暴露 / 共存。

## 6. 文档合并与放弃（本文的执行清单）

| 文档                                                   | 处置                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `proposed/2026-09-19-integration-replan.md`            | **已并入本文**（文件改名为 `2026-09-19-architecture.md`）                                        |
| `proposed/2026-09-16-vscode-integration-transport.md`  | **已移入 `abandoned/`**，`status: abandoned:superseded`（作为**计划**；其中 **P1 的内容保留**）    |
| `proposed/2026-09-15-vscode-capabilities-into-prac.md` | **已移入 `abandoned/`**，`status: abandoned:superseded`（作为**主线**；"view 是单位"等结论已继承） |
| `in-progress/2026-09-13-vs-concept-boundary.md`        | 保留（实现边界与 lib 抽出仍是现在的分层）                                                        |
| `in-progress/2026-09-09-vscode-dsh-integration.md`     | 保留为 umbrella；**§1 主线与 §4 待裁按本文重写**（本文定案后执行）                                |
| `docs/architecture.md`                                 | **已加"已被取代"横幅**；本文定案后整体重写                                                        |
| `docs/dsh.md` / `docs/vscode.md` / `worklog`           | 保留（事实参考，与本文不冲突）                                                                    |

## Related

- [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：umbrella（主线、需求约束、已定的决定）。
- [../../worklog/2026-09-09-vscode-dsh-integration.md](../../worklog/2026-09-09-vscode-dsh-integration.md)：依据（协议清单、已核实事实、决定台账）。
- [../../../docs/vscode.md](../../../docs/vscode.md) / [../../../docs/dsh.md](../../../docs/dsh.md)：两个系统的内部结构（事实参考）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：**旧的**目标架构（本文定案后重写）。
- [../abandoned/2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)：broker 设计（现为 P1 的备选）。
- [../abandoned/2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)：能力拆散带入（旧主线）。
