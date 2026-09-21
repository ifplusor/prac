---
status: proposed
---

# Agent Note: 架构（从需求出发重做）

> **由来**：2026-09-19 James ——「合并相关文档，放弃当前的架构设计，从需求出发，从头设计架构」。
> **这篇取代**：`2026-09-19-integration-replan.md`（同一件事的前半，已并进来并把文件名改成这篇）；[2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)（broker 那份设计）与 [2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)（把能力拆散带入 prac）**作为计划已经作废**，搬进了 `abandoned/`——内容没删，broker 那条降成这篇里的 P1。
> `docs/architecture.md`（旧的目标架构）等这篇定了再整体重写。两个系统的内部结构事实（[`docs/dsh.md`](../../../docs/dsh.md) / [`docs/vscode.md`](../../../docs/vscode.md)）不受影响。

## 1. 需求

这些是设计的全部出发点。每一条都注了出处。

| #   | 需求                                                                                                                                                                                                                                                                                                                   | 出处                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| R1  | **prac 的界面是给人用的，agent 跑在 prac 里。** 给人用的界面有两部分：人和 agent 打交道的地方（对话、讨论、计划与审阅、接手与打断），和帮他干活的 IDE（编辑器、问题、终端、SCM、搜索、资源）。另一头 prac 是 **agent 的运行时**：循环、工具、上下文、审批、沙箱、会话和持久化都在这里。**中心是人和 agent 的交互**，这两头都为了它。 | **James 2026-09-19**    |
| R2  | **协作方式**：共享工作区、结对干活。白板就是工作区里的文件（notes）。流程是人提想法 → 两人在白板上讨论 → agent 去做 → 人旁观、可打断、可接手 → review。**不是模式机**：没有"商定 / 实施 / 接管"这种要声明的状态，谁在驱动是事实。**界面跟着注意力走**，要能随手换焦点，也要有返回栈。恒在的是三样：导航（工作区/记录树）、**通道**（异步留言：你说的话等我看到）、我在改什么。主场景是单工作区、长时间、重度使用。**（09-19 澄清：需求里那个"通道"就是 chat——人和 agent 通过 chat 说话，chat 本身就是松耦合的，不单独做机制。）** | umbrella §2①            |
| R3  | **布局**：主操作台是注意力焦点，四周是辅助面板；交流时 chat 在中间，审方案时白板在中间、chat 在一边，审工件时编辑器在中间、chat 在一边、资源浏览器在另一边；主操作台能分栏；terminal 随时能调出来；各视图按需显示、能方便收起。                                                                                          | umbrella §2②            |
| R4  | **保留完整的 IDE 能力和扩展生态**（包括语言包、GitLens 这类 UI 扩展），**但不要 VS Code 的布局**。                                                                                                                                                                                                                      | umbrella §1.1           |
| R5  | **主干是 DSH**：组合、状态、进程、生命周期都归它。DSH 的扩展方式就是插件（同一地址空间，进程内 `inject`），prac 自己的部分和 VS Code 都作为插件挂在它上面。                                                                                                                                                            | James 2026-09-16        |
| R6  | **agent / chat 归 DSH**：VS Code 的 chat、participants、工具注册表、会话、agentHost 都不进 prac 的 agent 面。                                                                                                                                                                                                           | James 2026-09-19        |
| R7  | **VS Code 按 prac 的两端切成两半**：code server 是 server 侧的 remote（提供 IDE 基础能力），web 是 client 侧（提供 UI）。                                                                                                                                                                                                | James 2026-09-16        |
| R8  | **两半之间的通信层要基于 DSH 的架构重新设计**，不是把 VS Code 自己的传输透传过来。                                                                                                                                                                                                                                       | James 2026-09-16        |
| R9  | **不 fork 上游**：DSH 走它自己的组装层；VS Code 只 pin + patch + overlay，源码不进本仓。                                                                                                                                                                                                                                 | umbrella §1.3           |
| R10 | **三层各归其位**：`vendor/vscode`（上游源码 + 我们的 patch）；`vendor/vscode-embed`（在其上封装的 lib，可利用、不绑定 prac）；基于这个 lib 构建的 DSH 插件族（政策都在这一层）。                                                                                                                                           | James 2026-09-16        |
| R11 | **prac 不只有 VS Code 这一族插件**：还有 frame、编排、角色、注意力、持久化，还有 **agent 面（六件事）**，以及直接从 DSH 继承的能力族。                                                                                                                                                                                  | James 2026-09-16        |
| R12 | **VS Code 里最有价值的能力是 LSP**，要接进 DSH。                                                                                                                                                                                                                                                                        | James 2026-09-19        |
| R13 | agent 面归 DSH 之后，扩展生态里 agent 还能用的只剩 **MCP**（工具）和**文件定制**（`SKILL.md` / `*.instructions.md` / `AGENTS.md`）；扩展用 `lm.registerTool` 注册的工具我们拿不到。                                                                                                                                        | R6 的推论（09-19 核实） |
| R14 | 运行期状态跟随 XDG、放在仓库外；构建期状态放 `.build/`。                                                                                                                                                                                                                                                                | 已落地                  |
| R15 | **不引第三方改造**（`monaco-vscode-api`、Theia 这类）。                                                                                                                                                                                                                                                                   | umbrella §1.3           |

**agent 面就是六件事**：决策优先、依据是一等公民、可逆带检查点、审查是主界面、架构记忆、活的计划（见 `docs/philosophy.md`）。它归 DSH（R6、R11），是 prac 的立身之本，不是 IDE 的附属功能。

**最近核实到的三件事**（不是需求，但它们改了这个设计）：

1. 诊断是**只推不拉的有损缓存**——上限 1000 条/文件、`modelVersionId` 写进去没人读、还有一半根本产在渲染器里（任务匹配、设置校验、notebook、MCP、prompt）。
2. 语言特性和命令这类**要问一次才有的能力，由主线程发起**；而扩展可以经 `vscode.execute*Provider`（24 个）拿到它们。
3. 上游本来就把"在哪算"和"在哪显示"分开：装饰、状态栏、命令都由主线程代理。

细节见 [`docs/vscode.md`](../../../docs/vscode.md)。

## 2. 设计

### 2.1 给人用的，和给 agent 用的

新加一个东西之前，先回答两句话：**这是给人用的，还是给 agent 用的？它怎么帮到人和 agent 的交互？**

- **给人用的**：和 agent 打交道的界面（对话、计划、审阅、注意力、返回栈），以及辅助干活的 IDE 界面（编辑器、问题、终端、SCM、搜索、资源）。都在 client，由 prac 编排。
- **给 agent 用的**：运行时——循环、工具、上下文、审批、会话、持久化。在 server，由 DSH 提供。
- **同一份 IDE 能力，两边都用**：人用它的界面，agent 用它的能力（LSP、MCP、exec、文件工具）。所以下面每一条能力都要能说清它给谁用。

### 2.2 一条主干，两端

- 两端是 client（页面）和 server（Node）。DSH 在两端都提供骨架：client 侧是页面的壳（loader、槽、服务注册表），server 侧是组装、进程和 agent 循环。prac 自己的插件和 VS Code 的插件各按所属的一端挂上去。
- **主干只有一个**：组合和状态归 DSH；**code server 是主干起停的子进程**，不是第二个主干。
- 两端之间只有三条线：服务调用（DSH remote，client 调 host 声明的方法）、事件与流（转发事件，加上流复用）、页面产物（同源 HTTP）。
- **VS Code 的 extHost 协议不跨这条线**（R8）：它是 server 侧内部的事。

### 2.3 VS Code 的位置

`vendor/vscode`（上游 + patch）→ `vendor/vscode-embed`（lib：启动、资产、宿主元素、命令面）→ 插件族：**server 半边**管 code server 这个进程和政策（谁放哪、什么时候起、能力怎么给 agent），**client 半边**把编辑器和 IDE 面板贡献成 prac 的 view。**不让 VS Code 的布局主导 prac 的 frame**（R4）。

### 2.4 agent 的事都归 DSH

1. **和 agent 打交道这件事是 prac 的中心**（R1）：界面在给人那一侧，数据和运行在 DSH。chat 视图、工具调用与审批、计划与审阅都由 prac 编排。**VS Code 的 chat 面不出现在 prac 的界面里**——那是另一个 agent 的界面。
2. **chat 就是那个通道**（R2 的 09-19 澄清）：它天然异步、松耦合——谁不在都不阻塞，回来看会话记录就行。所以不另做"留言"机制，也不做模式机。
3. **白板就是文件**（R2）：notes 是工作区里的 markdown，人用 DSH 的文档视图看，agent 用文件工具读写。不需要第二套文档系统。
4. **树里住着"别人家的 agent"**：Copilot 是 VS Code 的内建扩展（它声明了 `chatParticipants`、`languageModelTools`、`mcpServerDefinitionProviders`、`chatSessions`、`chatPromptFiles`、`chatSkills`），会随扩展宿主激活——**在我们 rig 里到底有没有激活，还没测**。**先留着、不显示**（James 2026-09-19）：不禁掉，也不在 prac 的界面里露出它的 chat。好处是它声明的 MCP server 定义还在池子里（§2.6 要读的那些）；坏处是树里确实多一个 agent 在跑，先接受。

### 2.5 IDE 能力分三类

| 类别           | 是什么                                                     | 从哪来                                    | 给谁                                                               |
| -------------- | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| **语义服务**   | hover、定义、引用、符号、code action、语义 token、按需诊断 | 语言服务器（在扩展宿主里）；**主干自己连扩展宿主**（P1，§2.10） | **agent 优先**（R12）；人的编辑器也用它 |
| **工作区动作** | 文件、搜索、git、任务、调试、终端                           | code server（VS Code 的 API 和进程）      | 人用界面；agent 走 DSH 自己的 exec 和文件工具，**不和人那条终端共用** |
| **显示**       | 编辑器控件、面板、装饰、状态栏、视图                       | VS Code 的 client 半边                    | 人                                                                 |

**第三类不等于"扩展必须搬到 client"**：只要有一个主线程在，扩展可以在 server 侧跑、画面落到页面（为什么，见 §1 的第 3 条）。所以旧设计里"UI 组件必须在 client 侧"的读法不成立。

### 2.6 扩展生态里 agent 能用什么

1. **MCP**：扩展声明的 server 定义（`contributes.mcpServerDefinitionProviders`）、工作区配置、甚至别的工具（Claude Desktop / Cursor / Windsurf）的配置。**DSH 自己起 MCP 客户端**去连（James 2026-09-19）：只复用 VS Code 这边的 **server 定义来源**（扩展的声明点 + 工作区配置），不复用它的 `contrib/mcp` 客户端。
2. **文件定制**：`SKILL.md`、`*.instructions.md`、`AGENTS.md` 都是纯文件，**不共源**（James 2026-09-19）：DSH 用自己的 skill 与上下文格式，不去读 VS Code 的 `SKILL.md` / `*.instructions.md` / `AGENTS.md`，两边各管各的。
3. **扩展贡献的界面**（视图、编辑器、状态栏）——给人用。

### 2.7 界面：布局由 prac 拥有

- frame 是 prac 自己的：区域树、分割、堆叠、折叠、底栏、视图目录、持久化。**机制层不认识任何具体视图名。**
- **哪些 view 归谁，看它注册进哪儿**：`dsh:*`（对话、计划、审阅、笔记）和 `vscode:*`（编辑器、问题、终端、SCM、搜索、资源）都注册进同一个 `prac.view`，frame 一视同仁地摆。
- **注意力与返回栈是 frame 的能力**（R2）——它们是交互的机制，不属于任何单个视图。
- **编排单位是一个视图**（James 2026-09-19）：不是整块区域。编辑器那个面上的视图就是"一个文件的编辑面"（umbrella §3.5 已定），tab 与分栏由 frame 的 stage 提供，不用 VS Code 的 editor group。
- **`prac.view` 用单数**（跟 DSH 的 `root` / `sidebar` / `main` / `shell.overlay` 一致）：槽名说的是"装哪一类东西"，**装几个由槽的 `kind` 决定**（`single` / `list` / `keyed` / `chain`），单个 view 的身份是注册时的 `key`。所以不叫 `prac.views`。

### 2.8 人和 agent 看到的是同一份工作区：磁盘为准

**磁盘为准**（James 2026-09-19）：打开自动保存（切焦点或延时写盘）。人和 agent 读写的是同一份文件，页面里不再有"只有我看得到"的内容。

- 代价（接受）：没有"未保存"这个状态了，写盘也更频繁。注意我们现在的验证门为了别的原因**故意关掉了自动保存**，真实 rig 要打开。
- 反向那条（agent 改了文件 → 人的编辑器）：**接受 VS Code 既有的行为**——没脏就重载，脏了就提示冲突；不另做文档同步。
- 所以**不做**"把页面里未保存的缓冲区同步到主干"那条路（成本最高，现在也不需要）。

### 2.9 状态放在哪

| 状态                                             | 放哪                   | 为什么                                                          |
| ------------------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| 工作区文件                                       | 磁盘（见 §2.8）        | 这是人和 agent 天然共享的一份                                   |
| DSH 会话、工具、审批、计划、注意力               | DSH host               | agent 的事归 DSH（R6）                                          |
| code server 进程、扩展宿主、语言服务器、终端 PTY | server（主干起停）     | R5                                                              |
| 编辑器视图状态（打开的文件、布局、选择、折叠）   | client                 | 纯显示，**而且不给 agent**（James 2026-09-19）：agent 要知道人在看什么，靠人自己说，或者自己去看工作区和 git |
| 诊断、装饰、状态栏                               | server 算、client 显示 | 给 agent 的是语义服务，不是这份显示用的缓存（§2.5）             |

### 2.10 谁起谁关

code server 归主干起停：空闲端口、等就绪、随插件 dispose 收掉（**已经落地**）。

**扩展宿主也归主干（P1，James 2026-09-19）**：主干自己连一条 ExtensionHost 连接，**不依赖页面**——页面关着，语言服务照样在。要按需实现主线程那一面（三条初始化推送 + `ExtensionService` + `Errors` + **文档** + 我们挑的那几个 `$provide*`），代价是多一份激活上下文（两份 cSpell / 语言服务器）并要跟着上游漂移。

**硬前提**（09-19 核实）：**文档必须由我们喂给扩展宿主**——`HoverAdapter` 取文档时没有判空，末尾还会用 `doc.getWordRangeAtPosition()`。这不是为了编辑，而是每次问语言特性都要有一份活着的文档和版本号。

**本次范围**（James 2026-09-19）：**只把两边现有的东西结合起来，不往 DSH 里加能力**——VS Code 有而 DSH 缺的，先记下来，不立刻加。DSH 已经有 MCP 客户端（`packages/mcp/mcp-client`）、LSP seam、以及 fs / bash / terminal / todo / skill / subagent 这些工具族，够用。

**两边怎么结合**（James 2026-09-19：目标是更好地结合两边的生态与能力）：**DSH 出接口，VS Code 出实现与配置**。接口是 `ctx.lsp`（提供方注册表：`id` + `extensionToLanguage` + `query()`；按扩展名每次查询选一个）加面向模型的 `lsp` 工具（四个操作）；VS Code 那边做成**一个 `LspProvider`**——我们当主线程连扩展宿主（P1）、喂配置与文档、把结果翻译成 seam 的归一化形状。于是 DSH 自配的 stdio 服务器和 VS Code 扩展带来的服务器**都是提供方，可以并存**，而模型侧形状不变。四个操作之外的查询（符号、code action、诊断…）**不在本次范围**：那等于给 DSH 加能力，按 seam 的规矩扩（三处同改、编译强制），真要做时再说。

**P1 的前置条件**（核实过）：① **配置要喂**——扩展里的 `workspace.getConfiguration()` 等 `$initializeConfiguration` 开 barrier（`extHostConfiguration.ts:107-131`），不喂就挂；② **文档要喂**（含版本）；③ 激活（三条初始化推送 + `ExtensionService` + `Errors`）；④ 再是我们挑的 `$provide*`。第一条链用 checkout 自带的 css / html / json / markdown 语言服务器最省（真 `vscode-languageclient`，不用装市场扩展）。

### 2.11 插件怎么分

- `vendor/vscode`：上游 + 我们的 patch；`vendor/vscode-embed`：lib（只给机制，不背政策）。
- **server 半边**：路由、code server 起停、（如果走 P1）agent 侧的扩展宿主连接和主线程那一面。
- **client 半边**：frame 与编排、`vscode:*` 的 view、DSH 自己的视图（对话、计划、审阅、笔记）。
- 从 DSH 直接继承的能力族（tools、skill、goal、plan-mode、subagent、workflow）不动。

## 3. 每件事从哪来、给谁用

| 事情                                | 谁提供                               | 走哪条线                                       | 给谁                                         |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
| 和 agent 打交道（对话、计划、审阅） | DSH host 插件                        | DSH remote + 转发事件                          | 人（界面）；agent 是同一份会话的运行时        |
| 白板、笔记、工作区文档              | 工作区文件                           | 文件系统（§2.8）+ DSH 的文档视图               | 人（界面）+ agent（读写同一份文件）          |
| **语义服务（LSP）**                 | 主干连的扩展宿主（语言服务器）        | 主干自己当主线程（P1，§2.10）                  | **agent 优先**；人的编辑器复用               |
| 文件、搜索、git、任务、调试、终端   | code server                          | 页面内 UI；agent 走 DSH 自己的 exec 和文件工具 | 人（界面）+ agent（能力）                    |
| 诊断与 Problems                     | 扩展宿主 + 渲染器侧的生产者          | extHost 协议（server 侧内部）                  | **人**（agent 要的是语义服务，不是这份缓存） |
| 扩展贡献的视图                      | 扩展宿主                             | 主线程 → prac 的 view 目录 → 页面             | **人**                                       |
| **工具接入**                        | 扩展声明的 MCP server / 工作区配置   | **MCP**（DSH 自己起客户端，§2.6）              | **agent**（运行时）                          |
| **知识与定制**                      | DSH 自己的 skill / 上下文格式         | 文件（不与 VS Code 共源，§2.6）                | **agent**（运行时装载）；人也可以读          |
| 编辑器与 IDE 面板                   | `vendor/vscode-embed` + client 半边  | 页面内                                         | **人**                                       |

## 4. 旧设计：哪些留着，哪些作废

**留着**：主干是 DSH；两端；VS Code 一族插件按端切两半；三层（vendor / lib / 插件族）；布局由 frame 拥有、**view 是单位**；code server 归主干起停；XDG；不 fork 上游；"agent 执行命令走 DSH 自己的 exec，不和人那条终端共用"。

**作废或改正**（前提已经不成立，或者只是说法错了）：

1. **把"能力面（capabilities）驱动 UI 组件"当主轴**——它原来服务两拨人（UI 组件和 agent），现在两拨都不需要它了（§2.1）；
2. **把"拆散 UI 层"和"能力面驱动"捆在一起的那套说辞**——能力面没了（第 1 条），但**"拆散"本身是设计要求**：R2（界面跟着注意力走）、R3（布局规格）、R4（不要 VS Code 的布局）合起来要求 **prac 的编排单位是 view，IDE 的每一块都要能作为 view 被 prac 摆**（umbrella §3.2 已定"容纳单位 = view"）。跟 09-15 相比，变的只是**动机**——不是把能力带给 agent，而是**人看到的界面由 prac 编排**。
3. **把"broker 扮主线程"当默认路径**——降成 LSP 三条路里的一条（P1）；
4. **把诊断这类"已经跑完的结果"当 agent 能力**（§1 第 1 条）——它是给人看的显示，而且是缓存；
5. **VS Code 的 chat、participants、LM tools、会话、agentHost**（R6）；
6. **把 VS Code 的传输透传到页面**（R8；早就否了，这里记成终态）。

## 5. 下一步（验证）

七条待定都定了（P1 / DSH 自己起 MCP 客户端 / 不共源 / 磁盘为准 / 视图为单位 / 文件集合不给 agent / chat 面留着不显示）。接下来是把 P1 做出来，验收很具体：

1. **P1 的第一条链**：用 checkout 自带的语言服务器（css / html / json / markdown 之一）做通——主干连 ExtensionHost 连接，喂配置与文档，扩展注册 provider，我们就工作区里的文件问一次查询。**验收**：用的是**扩展带来的服务器与它的配置**（不是手配的），且能力面**不止那四个操作**。
2. **文档必须先喂**：这是上一条里最容易低估的部分（见 §2.10 的硬前提）。
3. **自动保存打开之后，验证门要重新看**：现在那几条"文件保持不动"的断言是靠**故意关掉 autoSave** 才稳的（§2.8）。

## 6. 这次合并了什么、放弃了什么

| 文档                                                   | 处置                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `proposed/2026-09-19-integration-replan.md`            | **已并进这篇**（文件改名成 `2026-09-19-architecture.md`）                                            |
| `proposed/2026-09-16-vscode-integration-transport.md`  | **已搬进 `abandoned/`**，`status: abandoned:superseded`（作为计划作废；里面的 **P1 内容保留**）       |
| `proposed/2026-09-15-vscode-capabilities-into-prac.md` | **已搬进 `abandoned/`**，`status: abandoned:superseded`（作为主线作废；"view 是单位"等结论已继承）   |
| `in-progress/2026-09-13-vs-concept-boundary.md`        | 保留（实现边界和 lib 抽取仍是现在的分层）                                                            |
| `in-progress/2026-09-09-vscode-dsh-integration.md`     | 保留为 umbrella；**§1 和 §4 等这篇定了重写**                                                         |
| `docs/architecture.md`                                 | **已加"已被取代"的说明**；这篇定了之后整体重写                                                      |
| `docs/dsh.md`、`docs/vscode.md`、worklog               | 保留（事实参考，和这篇不冲突）                                                                      |

## Related

- [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：umbrella（主线、需求约束、已经定下的决定）。
- [../../worklog/2026-09-09-vscode-dsh-integration.md](../../worklog/2026-09-09-vscode-dsh-integration.md)：依据（协议清单、核实过的事实、决定台账）。
- [../../../docs/vscode.md](../../../docs/vscode.md) / [../../../docs/dsh.md](../../../docs/dsh.md)：两个系统的内部结构（事实参考）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：**旧的**目标架构（这篇定了之后重写）。
- [../abandoned/2026-09-16-vscode-integration-transport.md](../abandoned/2026-09-16-vscode-integration-transport.md)：broker 那份设计（现在是 P1 的备选）。
- [../abandoned/2026-09-15-vscode-capabilities-into-prac.md](../abandoned/2026-09-15-vscode-capabilities-into-prac.md)：把能力拆散带入 prac（旧主线）。
