# Prac 的目标架构

> 面向目标的设计：prac 要成为什么、每部分为哪个目标而存在。实现进度、差距与踩坑在 [.agents/notes/](../.agents/notes/)；理念见 [philosophy.md](philosophy.md)；两个被依赖系统的内部结构见 [dsh.md](dsh.md) / [vscode.md](vscode.md)。
> 设计取舍的讨论与依据在 [in-progress/2026-09-19-architecture.md](../.agents/notes/in-progress/2026-09-19-architecture.md)（从需求重做的那一版）。

## 1. 目标

### 1.1 prac 是什么

- **界面是给人用的**，两部分：① **和 agent 打交道**——对话、讨论、计划与审阅、接手与打断；② **帮他干活的 IDE**——编辑器、问题、终端、SCM、搜索、资源。
- **另一头，prac 是 agent 的运行时**：循环、工具、上下文、审批、沙箱、会话和持久化都在这里。
- **中心是人和 agent 的交互**。界面跟着注意力走（谁在中心、谁在侧边随手换，有返回栈）；**chat 就是通道**（天然异步、松耦合：谁不在都不阻塞）；**白板就是工作区里的文件**（notes 是 markdown，人和 agent 读写同一份）。
- **保留完整的 IDE 能力与扩展生态**（包括语言包、GitLens 这类扩展），**但不要 VS Code 的布局**。

### 1.2 出发点

1. **责任放对地方**：AI 做有界认知，人负责意图与高杠杆判断，harness 负责可核实的事实账户——让责任**可行使**（暴露推理、可验证、可回滚），不是可甩脱。
2. **区分真假天花板**：模型确实做不到 vs rig 没给够东西；后者是机会。
3. **按认识论循环工作**：决定 → 验证 → 重审，不是计划 → 执行 → 交付。
4. **两个生态都用上**：DSH 的成熟骨架与生态、VS Code 的完整 IDE 能力与生态——把两边拆散，按 prac 的目标重新组装。

### 1.3 三条不变量

1. **不 fork DSH**：改变行为走它的组装层（bundle / profile / patch）。
2. **不 fork VS Code**：只 pin + patch + overlay，源码不进本仓，改动小到可审计。
3. **不引第三方改造**（`monaco-vscode-api`、Theia 这类）。

### 1.4 本次范围：只做结合，不往 DSH 里加能力

**把两边现有的东西接起来**，就这一件事。**VS Code 有而 DSH 缺的，不立刻加到 DSH 里**——先记下来，等真的需要再说。

| DSH 现有的（直接用）                                                                                                                                                                  | VS Code 现有的（接进来）                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| agent 循环、会话与 session log、审批与沙箱、持久化                                                                                                                                    | 语言服务器（扩展生态带来的 + 内置的 css / html / json / markdown） |
| 工具族：`fs` / `fs-search` / `bash` / `terminal` / `str-replace-editor` / `todo` / `skill` / `subagent` / `goal` / `ask-user` / `web` / `jobs` / `session-query` / `workflow` / `lsp` | IDE 能力：编辑、搜索、git、任务、调试、终端                        |
| MCP 客户端（`packages/mcp/mcp-client`）                                                                                                                                               | 扩展贡献的界面（视图、编辑器、状态栏）                             |
| LSP seam（`ctx.lsp`）与 `lsp` 工具（四个操作）                                                                                                                                        | `execute*Provider` 那 24 个查询                                    |

一句话：**本次 = 把 VS Code 现有的东西，接到 DSH 现有的接口上；接口不够用时，不扩接口，只记录。**

**本次要接的点**：① VS Code 的语言服务器 → `ctx.lsp` 的一个 provider（§4.2）；② VS Code 的 MCP server 定义 → DSH 现有的 MCP 客户端（§4.3）；③ VS Code 的界面 → prac 的 view，由 frame 摆（§3）；④ 人和 agent 对着同一份工作区文件（磁盘为准，§5.1）。

## 2. 总体形态

### 2.1 一条主干，两端

- **两端**：client（页面）与 server（Node）。DSH 在两端都提供骨架——client 侧是页面的壳（loader、模块表、槽、服务注册表），server 侧是组装、进程和 agent 循环。**DSH 插件**与 **VS Code 扩展**按所属的一端挂上去。
- **主干只有一个**：组合、状态、进程、生命周期归 DSH。**code server 是主干起停的子进程**，不是第二个主干。
- **扩展宿主也归主干**：主干自己连一条 ExtensionHost 连接，**不依赖页面**（见 §4.2）。

### 2.2 VS Code 的位置

`vendor/vscode`（上游源码 + 我们的 patch）→ `vendor/vscode-embed`（在其上封装的 lib：启动、资产、宿主元素、命令面；**只给机制，不背政策**）→ 基于这个 lib 的 DSH 插件族：

- **server 半边**：管 code server 这个进程和政策（谁放哪、什么时候起、能力怎么给 agent），以及主干那条扩展宿主连接。
- **client 半边**：把编辑器和 IDE 面板贡献成 prac 的 view。

**不让 VS Code 的布局主导 prac 的 frame**。

### 2.3 agent 的事都归 DSH

- **和 agent 打交道是 prac 的中心**：界面在给人这一侧，会话、工具调用与审批、计划与审阅的数据与运行在 DSH。**VS Code 的 chat 面不出现在 prac 的界面里**（它是另一个 agent 的界面）——先留着不显示；它声明的 MCP server 定义仍然可用。
- **白板就是文件**：不做第二套文档系统。
- **对话以外没有第二个通道**：不另做"异步留言"的机制或视图。

### 2.4 端之间只有三条线

| 线             | 载体                                          | 内容                               |
| -------------- | --------------------------------------------- | ---------------------------------- |
| 页面上屏与产物 | 同源 HTTP（静态 + 启动注入）                  | HTML、`client.js` 产物、boot 图    |
| 服务调用       | DSH 的 remote 面（client 调 host 声明的方法） | 会话、工作区、工具结果             |
| 事件与流       | 转发事件（host → client）+ 流复用             | 状态变化、流式输出、受限的反向回答 |

**VS Code 的 extHost 协议不跨这条线**：它是 server 侧内部的事。

## 3. 界面

### 3.1 布局由 prac 拥有

- **frame** 是 prac 自己的：区域树、分割（任意方向）、堆叠、折叠（记尺寸）、常驻底栏、视图目录、持久化。**机制层不认识任何具体视图名。**
- **编排单位是一个视图**：不是整块区域。`dsh:*`（对话、计划、审阅、笔记）和 `vscode:*`（编辑器、问题、终端、SCM、搜索、资源）都注册进**同一个 DSH 槽 `prac.view`**，frame 一视同仁地摆。
  - `prac.view` 用单数：槽名说的是"装哪一类东西"，**装几个由槽的 `kind` 决定**（`single` / `list` / `keyed` / `chain`），单个 view 的身份是注册时的 `key`。
- **注意力与返回栈是 frame 的能力**，不属于任何单个视图。
- 视图契约、树形摆放、收起记宽这类做法借鉴上游，frame 由 prac 拥有。

### 3.2 IDE 那一半怎么进来

- **编辑器** = **一个文件的编辑面**（一个视图），不是 editor part / editor group；**tab 与分栏由 frame 的 stage 提供**。
- 扩展贡献的视图（tree view 等）也按视图进来；容器与 part 是可选的高级形态（整块标准 IDE 区域），不是组合的单位。
- 现在的落点是「编辑器 / 侧栏」这类面，其余 IDE 面按同一套规矩逐步接。
- 已知的坑：视图要进 VS Code 自己的可见性模型，否则 body 会是 "no data provider registered"。

### 3.3 状态住在哪

| 状态                                             | 放哪                   | 为什么                                                     |
| ------------------------------------------------ | ---------------------- | ---------------------------------------------------------- |
| 工作区文件                                       | **磁盘**（见 §5.1）    | 人和 agent 天然共享的一份                                  |
| DSH 会话、工具、审批、计划、注意力               | DSH host               | agent 的事归 DSH                                           |
| code server 进程、扩展宿主、语言服务器、终端 PTY | server（主干起停）     | 进程与生命周期归主干                                       |
| 编辑器视图状态（打开的文件、布局、选择、折叠）   | client                 | 纯呈现，**而且不给 agent**：agent 要知道人在看什么，靠人说 |
| 诊断、装饰、状态栏                               | server 算、client 显示 | 给 agent 的是语义服务，不是这份显示用的缓存（§4.1）        |

### 3.4 持久化

区域尺寸、每个 view 的折叠状态、堆叠顺序、哪些 view 在屏上。两份 key：**per-window**（布局）与 **per-workspace**（展开项）；key 带版本，恢复时不校验形状。**默认放置只填空缺**——否则每次激活都把视图拖回出厂位。边界：localStorage 是 per-origin，同源两个 tab 共用一份。

## 4. 能力

### 4.0 能力怎么进 prac：接口在 DSH，提供方在任一边

这是本文档里对"结合两边生态"最重要的一条：

- **接口在 DSH**：agent 面向的能力做成 DSH 的能力 seam（`ctx.lsp`、`ctx.tools`、MCP 客户端…）——**形状稳定**，换提供方不改变模型请求的方式。
- **提供方在任一边**：实现可以由 DSH 自己起，也可以由 VS Code（或别的来源）提供；同一个能力可以有多个提供方并存。
- 所以"agent 面归 DSH"和"用 VS Code 的生态"不矛盾：**DSH 出接口与组装，VS Code 出实现与配置**。
- 注意区分两件事：旧设计里那个"给 UI 用的快照/订阅能力面"确实不要了（§4.1 第三类）；这里说的是**给 agent 的能力 seam**，DSH 本来就有这套机制。

### 4.1 IDE 能力分三类

| 类别           | 是什么                                                     | 从哪来                                                             | 给谁                                                                  |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **语义服务**   | hover、定义、引用、符号、code action、语义 token、按需诊断 | 语言服务器；插件里它们住在扩展宿主，**主干自己连那个宿主**（§4.2） | **agent 优先**；人的编辑器复用                                        |
| **工作区动作** | 文件、搜索、git、任务、调试、终端                          | code server（VS Code 的 API 和进程）                               | 人用界面；agent 走 DSH 自己的 exec 与文件工具，**不和人那条终端共用** |
| **显示**       | 编辑器控件、面板、装饰、状态栏、视图                       | VS Code 的 client 半边                                             | 人                                                                    |

第三类不等于"VS Code 扩展必须搬到 client"：上游把"在哪算"和"在哪显示"分开（装饰、状态栏、命令都由主线程代理），所以只要有一个主线程在，扩展可以在 server 侧跑、画面落到页面。

### 4.2 语义服务（LSP）：DSH 出接口，VS Code 出服务器

**主干自己连一条 ExtensionHost 连接**，扮演主线程，按需实现：

- 三条初始化推送（配置 / 工作区 / 遥测级别）；
- `ExtensionService` + `Errors`（激活本身与错误上报）；
- **文档**——把扩展宿主需要的文档喂给它；
- 我们挑出来的那几个 `$provide*`（先挑 hover / definition，其余按需要加）。

**为什么这样**：agent 不该依赖页面（页面关着也要能用语言服务），而语言特性的调用方向是"主线程发起"，所以这一面必须有人当。

**代价**：多一份激活上下文——**UI 的宿主与 agent 的宿主是两份**（James 2026-09-21：UI 不和 agent 共用）。要跟着上游漂移。

**宿主是几个**（James 2026-09-21 定）：**agent 侧，一个工作区一个宿主**——同一个工作区的多个 agent 共用它（它们本来就是同一个主线程后面的不同调用方，各起一份只是把同样的扩展、同样的语言服务器再复制一遍）；**UI 侧仍按上游行为，每个页面（client）一个宿主**。宿主中途死掉时丢掉它、下一次查询重新起一个（不把一次崩溃变成所有人的故障）。

**为什么 per-agent 不做**：不是不愿意，是**接口表达不了**——seam 的查询里只有 `workspaceRoot`，没有会话/agent 标识；要按 agent 分，就得先给 DSH 的 seam 加一个会话键（本次范围外，先记着）。

**硬前提**：**文档必须由我们喂**。扩展宿主取文档时没有判空、末尾还会用 `doc.getWordRangeAtPosition()`——这不是为了编辑，而是每次问语言特性都要有一份活着的文档和版本号。

**两边怎么结合**（James 2026-09-19：目标是更好地结合两边的生态与能力）：

- **DSH 出接口**：`ctx.lsp` 是一个能力 seam——提供方注册表（`id` + `extensionToLanguage` + `query()`），按文件扩展名每次查询选一个提供方；面向模型的 `lsp` 工具（四个操作：转到定义 / 查引用 / 查实现 / 悬停）是稳定的形状。**换提供方不改变模型请求导航的方式。**
- **VS Code 出实现与配置**：把 VS Code 那边做成**一个 `LspProvider`**——我们当主线程连扩展宿主（P1），喂配置与文档，把扩展语言特性的结果翻译成 seam 的归一化结果。
- **于是两边的服务器可以并存**：同一批语言上，DSH 自配的 stdio 服务器和 VS Code 扩展带来的服务器都是提供方，模型侧看到的还是那四个操作。

**为什么值得把 VS Code 这一边接进来**：那边有的东西别处给不了——哪个语言用哪个服务器、谁优先、多个提供方怎么合并；服务器的安装与版本由扩展生态管（内置的 css / html / json / markdown 就在 checkout 里，不用装VS Code 市场扩展；TypeScript 那份是 VS Code 扩展自带的 `tsserver`，**不是 LSP**）；初始化参数与配置；以及**全集的查询**（`vscode.execute*Provider` 24 个：hover / definition / references / implementation / symbols / code actions / completion / semantic tokens / inlay hints / call hierarchy / formatting / rename…）。

**那四个操作之外的查询（符号、code action、诊断…）不在本次范围**：DSH 的 seam 只有四个操作，要更多就等于**给 DSH 加能力**（§1.4）。先记下来，不做；真要做时按 seam 的规矩扩操作联合（seam / 提供方 / 工具三处同改，编译强制）。

**P1 的前置条件**（都在代码里核实过）：

1. **配置必须喂**：扩展里的 `workspace.getConfiguration()` 会等 `$initializeConfiguration` 开 barrier（`extHostConfiguration.ts:107-131`；主线程在 `mainThreadConfiguration.ts:29` 推，变化时 `:31` 推 `$acceptConfigurationChanged`）——不喂，扩展就挂在配置上。
2. **文档必须喂**（含版本），见下面的硬前提。
3. **激活**：三条初始化推送 + `ExtensionService` + `Errors`。
4. 然后才是我们挑的 `$provide*`。

**第一条端到端验收最省的素材**：用 checkout 里自带的 **css / html / json / markdown** 语言服务器（它们是真 `vscode-languageclient`），不用装VS Code 市场扩展。

### 4.3 扩展生态里 agent 能用什么

- **MCP**（工具接入）：**DSH 已经有 MCP 客户端（`packages/mcp/mcp-client`）**，用它；只把 VS Code 这边的 **server 定义来源**（扩展的声明点 + 工作区配置）接过去，server 本身可以是任何来源。这是 §4.0 那条原则的另一个例子，也是"只用现有的"的另一个例子。
- **文件定制**：**不共源**——DSH 用自己的 skill / 上下文格式（它已经有 `skill` 那一族），不去读 VS Code 的 `SKILL.md` / `*.instructions.md` / `AGENTS.md`。
- **扩展贡献的界面**（视图、编辑器、状态栏）——给人用。

拿不到的：VS Code 扩展用 `contributes.languageModelTools` / `lm.registerTool` 注册的工具（那要重实现它的工具注册表与 `$invokeTool`，等于把 agent 面搬过来）。

### 4.4 agent 怎么用这些

循环、工具、上下文、审批、会话都在 DSH：语言智能经 §4.2 的那条连接，外部工具经 §4.3 的 MCP 客户端，文件与命令走 DSH 自己的 exec 与文件工具。

**agent 面（六件事）** 是 prac 的立身之本：决策优先、依据是一等公民、可逆带检查点、审查是主界面、架构记忆、活的计划——**优先以纯消费者身份**塞进 DSH 现有循环的扩展点（工具 + 上下文 + 呈现），只有确需驱动轮次结构本身才更深介入，并且要显式记录。

## 5. 工作区与进程

### 5.1 磁盘为准

**人和 agent 读写同一份文件**：打开自动保存（切焦点或延时写盘），**不做**缓冲区级同步。反向那条（agent 改文件 → 人的编辑器）接受 VS Code 既有行为：没脏就重载，脏了就提示冲突。

代价（接受）：没有"未保存"这个状态，写盘更频繁。注意：验证门为了别的原因**故意关掉了自动保存**，那里要重新看（见 §7）。

### 5.2 谁起谁关

code server 归主干起停（空闲端口、等 `/version` 就绪、随 DSH 插件 dispose 收掉）；扩展宿主同样是主干那条连接的产物。工作区不由 code server 的启动参数决定——它来自 DSH 绑定的会话工作区。

## 6. prac 自己的机制

### 6.1 frame

见 §3.1。

### 6.2 编排与角色

默认视图与默认落位、角色绑定、注意力（调出面 / 快捷键）、"只填空缺"的默认放置语义。**机制不知道谁是 sidebar**——角色由编排绑定。

### 6.3 怎么知道设计成立了

| 检查                      | 断言什么                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **单元测试**（`vp test`） | 机制：纯函数与纯算术（区域树重写、尺寸分配、折叠与缓存、子序、clamp、编排语义、持久化往返）           |
| **浏览器里跑真页面**      | 真页面才能证明的事：产物过真 loader、视图挂进搬出 prac 区域并画出像素、VS Code 扩展真的激活、契约成立 |
| **每条能力一条渲染断言**  | 拦住"模型对了、渲染器没跟上"这类单元测试看不见的假绿                                                  |

## 7. 还没定的

1. **第一条链已经通了**（css VS Code 内建扩展；四道门见工作记录）。**两组后续都搁置**（James 2026-09-21）：把 **json / html / markdown** 也编译进来（同一套手续、成本小），以及 **MCP 定义接线**（把 VS Code 那边的 server 定义来源接给 DSH 现有的 MCP 客户端）。
2. **自动保存打开之后，验证门怎么调**：现在那几条"文件保持不动"的断言是靠故意关掉 autoSave 才稳的；`verify-file` 最近一次是 33/33 直接绿的，与旧注意不一致，待查。
3. **Copilot 在我们 rig 里到底有没有激活**（实测）——它决定"树里多一个 agent"是理论问题还是已经在发生。**已知一条相关事实**：打开页面时 code server 会拉起一个 `--type=agentHost` 进程（VS Code 自己的 agent 层的服务端形态）。
4. **按工作区 / 按 agent 配置装哪些 VS Code 扩展**（James 2026-09-21）。**"插件族的划分"这个问题撤销了**——不需要区分哪个 DSH 插件算 server 侧、哪个算 client 侧；要的是**VS Code 扩展贡献的 view 能上屏**（数据那一半见下条）。**James 定**：**用 VS Code 自己的按工作区启用/禁用，不另造配置机制**。
   **两个消费者在两种形态里，状态各归各家**（James 2026-09-21）：**UI 走 web**（它的按工作区启停是浏览器里的状态——`BrowserStorageService` 用 IndexedDB 存所有域含 workspace，`web.main.ts:613-614` 构造它时无 remote 分支），**由 VS Code 自己管它的宿主，我们什么都不用做**；**agent 不是 web、是服务端消费者**，所以它的"装什么"要由**服务端的事实**决定。⇒ 两边**不需要互相镜像**，也不该为一个统一机制去发明东西。
   **要接受的一处不一致**：**UI 里禁用的扩展，agent 那边仍会加载**——这是 web 形态的必然，不是缺陷（桌面/远程形态相反：那边渲染器存储本来就在服务端）。
   **"对齐 remote 形态"买不到服务端那份状态（已核实）**：remote 形态里渲染器的存储走 `'storage'` 通道，而那个通道是 **main process（客户端机器）** 的——`NativeWorkbenchStorageService` 把 `mainProcessService` 当 remote service 传进去（`electron-browser/storageService.ts:16`），`RemoteStorageService` 用它取 `getChannel('storage')`（`platform/storage/common/storageService.ts:53,109`）；**code server 注册的通道里没有 `'storage'`**（只有 extensions / logger / userDataProfiles / remoteextensionsenvironment / request / telemetry / remoteFileSystem / remoteTerminal / remoteExtensionsScanner / mcp…）。⇒ **每种形态下"按工作区启停"都是客户端状态**（桌面 → 本机 main process 的 SQLite；web → IndexedDB）。而且 remote 形态里**服务端那个扩展宿主也不自己决定装什么**：`allExtensions` / `myExtensions` 由渲染器算好交给它（`extensionHostManager.ts:425-431`）。
   ⇒ 所以 agent 侧没有"对齐 remote 就拿到服务端状态"这条路；剩下三种：**(a) 全上**（现状）、**(b) 我们自己给 agent 一份服务端策略**（工作区文件 / DSH 设置——与 VS Code 的启停不冲突，但确实是**我们自己的状态**）、(c) 由页面告诉它（违背"不依赖页面"）。**按 agent 仍卡在 seam**（查询入参没有会话标识，`packages/lsp/lsp/src/types.ts:38-57`）。
5. **VS Code 扩展贡献的 view 要能"出数据"**：现在 `mountViewInto` 能让扩展视图出 pane、标题与像素，但 **tree view 的 body 是 `no data provider registered`**——要让它进 VS Code 自己的可见性 / 容器模型，树的数据才会来。这是"支持 VS Code 扩展贡献的 view"的实事。
6. **container / part 这类高级形态什么时候真的需要**（现在是按视图组合就够）。
7. **多窗口 / 多标签页**：**搁置**（James 2026-09-21：先保持简单，以后再说）。已核实的底子：多标签页在 DSH 身份层就是**一个 client**（浏览器会话 cookie）；VS Code 自己的多窗口机制是 **auxiliary window**（`window.open` 出来的窗口 attach 到同一个 workbench 实例，**不新增扩展宿主**），但它绕开 prac 的 frame（内容由 workbench 自己搬），要用得先在 prac 侧设计"窗口"这个概念。今天两个标签各 boot 一个实例 ⇒ 两个宿主。
8. **阶段二**（决策空间 / 以审决策为主界面）：保持搁置，重新进入主线需要重新裁决。

## 8. 相关

- [philosophy.md](philosophy.md)：两个轴 + 认识论循环 + 决策单元（§1.2 的出发点）。
- [dsh.md](dsh.md) / [vscode.md](vscode.md)：两个被依赖系统的内部结构（事实参考）。
- [.agents/notes/](../.agents/notes/)：决策记忆（每个「为什么 + 放弃了什么」）与实现进度、差距、踩坑。
- [in-progress/2026-09-19-architecture.md](../.agents/notes/in-progress/2026-09-19-architecture.md)：这一版设计是怎么从需求推出来的（含旧设计哪些留着、哪些作废）。
- DSH 自己的 LSP 栈：`packages/lsp/`（`ctx.lsp` / stdio 提供方 / `lsp` 工具）——可选能力，只有四个操作、不带服务器；见 [dsh.md](dsh.md)。
- [in-progress/2026-09-09-vscode-dsh-integration.md](../.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md)：umbrella（主线、需求约束、已经定下的决定、与目标的差距）。
- [.agents/worklog/2026-09-09-vscode-dsh-integration.md](../.agents/worklog/2026-09-09-vscode-dsh-integration.md)：依据（协议清单、核实过的事实、踩坑、决定台账）。
