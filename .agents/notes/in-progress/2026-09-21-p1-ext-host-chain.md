---
status: in-progress
---

# Agent Note: P1 第一条链 —— 让主干接上 VS Code 的扩展宿主（实现计划）

> **这是哪件工作**：umbrella [2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md) 的第一步。设计与理由见 [2026-09-19-architecture.md](../in-progress/2026-09-19-architecture.md)（§2.10 / §4.2 / §5）与 [`docs/architecture.md`](../../../docs/architecture.md)（§4.2 / §5.2 / §7.1）。
> **状态**：三个点**已裁**（James，2026-09-21，见 §3）；工作在进行中——第一步是"让VS Code 内建扩展变成可加载的"。
> **本次范围**：只把两边现有的东西接起来（`docs/architecture.md` §1.4）——不往 DSH 加能力、不改上游 VS Code。

## 1. 做什么、验收是什么

**做什么**：主干（DSH 侧 node 进程里的一个插件）拿到一条 VS Code 扩展宿主的连接、扮演主线程，把扩展语言特性的结果翻成 DSH `ctx.lsp` 的**一个 provider**。

**验收**（James 已定，`docs/architecture.md:208`）：VS Code 扩展**激活** → 我们喂**配置与文档** → 它注册 provider → 我们就工作区里的文件**问一次查询**并拿到真实结果；作为 `ctx.lsp` 的一个 provider 被 agent 用上；**模型侧接口不变、DSH 不加新能力**；用的是**扩展带来的服务器与它的配置**（不是手配的）；**页面关着也能用**。

**不做**：seam 四操作（定义 / 引用 / 实现 / 悬停）之外的查询——那等于给 DSH 加能力（`docs/architecture.md:151`）。

## 2. 已经核实的事实

三份只读侦察（DSH 契约 / 上游机制 / prac rig），以下每条都带 `file:line`。

### 2.1 DSH 侧：provider 的契约（`packages/lsp/lsp/src/`）

- `ctx.lsp` 是提供方注册表：`registerProvider(provider): () => void`（`types.ts:121`）、`query(request, signal?)`（`types.ts:129`）。provider 只要三个成员：`id`、`extensionToLanguage`（扩展名 → languageId）、`query()`（`types.ts:95-107`）。
- 查询入参 `{operation, filePath, position:{line,character}, workspaceRoot}` ＋ `languageId`；**坐标 0-based UTF-16**（`types.ts:38-57`）；操作联合**封闭四值**（`types.ts:17`）。
- 返回两种：`{kind:'locations', locations, resolvedWorkspaceUri}` / `{kind:'hover', hover|null}`（`types.ts:85-87`）；**空结果不是错误**。
- **没有 capabilities 字段**：seam 不拦截 operation、也不校验返回形状与 operation 是否匹配（`index.ts:143-149`）；不支持的操作由 provider 自己决定抛 `LspError` 还是返回空。
- 注册时扩展名冲突 / id 重复会抛 `LSP_CONFLICT`（后注册者失败，不覆盖，`index.ts:90-141`）。`extensionToLanguage` 既用于选路，也是 `didOpen` 的 languageId；匹配只看最后一段扩展名（`index.ts:60-67`）。
- **lsp 三包不在任何 bundle/profile 里**（bundle 与 patch 全文无 lsp）：要在 prac 自己的 bundle patch 里显式插 `{id: lsp, name: '@deepseek-ai/dsh-lsp'}` ＋ 我们那个 provider 插件行（样例 `snapshots/session/lsp-definition/cordis.yml:3-16`；patch 写法 `packages/boot/app-boot/README.md:45-59`）。
- provider 随调用 fiber 释放（`types.ts:116-120`），异步准备用 `ctx.effect`（样板 `packages/lsp/lsp-stdio/src/index.ts:171-185`）。

### 2.2 VS Code 侧：扩展宿主怎么起、协议是什么

- **扩展宿主进程**：`cp.fork(<build 根>/bootstrap-fork.js, …)`，env 必须有 `VSCODE_ESM_ENTRYPOINT=vs/workbench/api/node/extensionHostProcess`（`bootstrap-fork.js` 靠它 import 入口）；`--type=extensionHost` **没人读**，只是进程标识。
- **三种载体**（`extensionHostEnv.ts:8-12`）：MessagePort（依赖 Electron，纯 node **不可用**）、Socket（要先 IPC 发 socket 过去）、**IPC 管道**（`VSCODE_EXTHOST_IPC_HOOK=<路径>`，ext host 自己 `net.createConnection`，最省）。
- **载体之上不是裸字节**：是 `NodeSocket` + `PersistentProtocol` 帧（`src/vs/base/parts/ipc/common/ipc.net.ts:816/429`）；再之上才是 RPC。
- **RPC 帧**：`UInt8 type + UInt32BE req + payload`，12 种 type（`rpcProtocol.ts:940-953`）；短字符串 UInt8 长度前缀（方法名）、长字符串 UInt32BE（JSON 载荷）。代理标识是 `ProxyIdentifier`，**线上只发 `nid`，UInt8**（`rpcProtocol.ts:777/803`），实测 import 后 `count === 168`（MainContext 87 + ExtHostContext 81）⇒ **余量 87，别再 import 会造 id 的模块**。
- **握手顺序固定**（不可换）：ext host 先发 `Ready`（字节 `0x02`）→ 我们发**一帧 UTF-8 JSON** 的 `IExtensionHostInitData` → ext host 回 `Initialized`（`0x01`）。**在它收到 initData 之前发 RPC 帧会让它 `JSON.parse` 崩**（`extensionHostProcess.ts:336-339`）。
- **initData 必填字段**：`version` / `quality` / `parentPid`（给 0 关掉看门狗）/ `environment{appLanguage, appHost, …}` / `extensions{allExtensions, activationEvents, myExtensions}` / `telemetryInfo` / `logLevel` / `loggers` / `logsLocation` / `remote` / `consoleForward` / `uiKind` / `autoStart`（`extensionHostProtocol.ts:28-66`）。
- **`autoStart` 与 `$startExtensionHost` 二选一**：`autoStart:true` 时 ext host 自己启动，再发 `$startExtensionHost` 会被 `Extension host is already started!` 拒（`extHostExtensionService.ts:246-247`、`:828-831`）。
- **握手后必须主动推两件，否则 VS Code 扩展永远不激活**：`$initializeWorkspace`（它才开 barrier，`extHostWorkspace.ts:268-272`，而 `initialize()` 在 `extHostExtensionService.ts:243` 阻塞等它——**不推是死锁，不是降级**）与 `$initializeConfiguration`（`extHostConfiguration.ts:126-131`；不推连 `vscode` 模块都注入不出来）。然后才是 `$activateByEvent(...)`。
- **主线程必须注册的 id**：无条件 5 个——`MainThreadExtensionService`（8 个方法）、`MainThreadErrors`、`MainThreadStorage`（**最容易漏：缺它表现为激活卡住，不报错**，`extHostStorage.ts:32-40`）、`MainThreadTelemetry`、`MainThreadLanguageFeatures`（我们等的 `$registerHoverProvider` 在这，`extHost.protocol.ts:537`）；按 VS Code 扩展行为再补 `MainThreadCommands` / `MainThreadDiagnostics`，以及 languageclient 会用到的 `MainThreadWorkspace` / `Configuration` / `Documents` / `FileSystem` / `MessageService` / `Window` / `OutputService` / `Languages`。未注册的 id 被调用会对端 promise 以 `Unknown actor` reject（`rpcProtocol.ts:452`）。
- **不要调 `assertRegistered`**：那会要求实现全部 87 个 MainContext id（`rpcProtocol.ts:271-278`；唯一调用点 `extensionHostManager.ts:314`）。自己实现需要的几个 shape 即可。
- **commit 校验**：initData 的 `commit` 与 ext host 自己那份 `product.json#commit` 不等 → 立刻 exit 55；**给 `undefined` 则跳过**（`extensionHostProcess.ts:341-349`）。
- **主线程那面没有现成东西可复用**：reh / web 产物里都没有 `vs/workbench/api/common`；主线程实现只存在于 renderer bundle 里。
- **但 `out-build/` 可 import**（实测）：它是**我们自己的构建产物**（`vendor/vscode/scripts/build.mjs:275` 第 4 步 transpile `src/` → `out-build`）。`rpcProtocol.js`、`extHost.protocol.js` 都能直接 import（需要 3 个全局 `_VSCODE_PRODUCT_JSON` / `_VSCODE_PACKAGE_JSON` / `_VSCODE_FILE_ROOT`），`mainThreadLanguageFeatures.js` / `mainThreadDocuments.js` / `mainThreadConfiguration.js` 也能 import；`mainThreadExtensionService.js` 要 `window`（得 shim），聚合入口要 CSS loader（不能用）。`out-build` **没有 `.d.ts`**。

### 2.3 主线程那一端的最小接口（侦察 ad6674db 定稿）

- **不做就"挂起"（不是报错）**：`$initializeWorkspace`（barrier 不开）、`$initializeConfiguration`（barrier 不开）、`MainThreadExtensionService.$onWillActivateExtension`（ext host await 它）、`MainThreadStorage.$initializeExtensionStorage`（缺它 memento 的 `whenReady` reject ⇒ 激活失败；**返回 `undefined` 即可**）。
- **"喂文档"就是两条推送**：`$acceptDocumentsAndEditorsDelta`——`IModelAddedData.lines` **是全文**，ext host 拿它建本地镜像，**没有"回主线程读文本"的 RPC**；之后每次编辑推 `$acceptModelChanged`（增量 + `versionId` + `eol`）。查询那一刻文档不在镜像里 ⇒ hover 直接 reject。
- **要收注册的**：`MainThreadLanguageFeatures.$registerHoverProvider(handle, selector)`（**hover 没有 metadata**；`selector` 是 `{$serialized, language?...}` 的数组）；主线程把 `handle` 当**不透明键**存表，回调时原样回传。
- **配置**：`workspace.getConfiguration()` **不发 RPC**，全从 `$initializeConfiguration` 那份 `data` 读；**VS Code 扩展自己的默认值要我们自己**从它 `package.json` 的 `contributes.configuration` 展开进 `data.defaults.contents`（协议里根本没有 `configurationDefaults` 这个参数）。
- **`MainThreadLocalization`**：`appLanguage !== 'en'` 时必需（VS Code 内建扩展加载模块前会问它，且这一步不在 try 里）⇒ **`appLanguage:'en'` 最省**。
- **可以空实现**：Telemetry / Logger / MessageService / `Window.$getInitialState` / Languages / Workspace 的其余方法。
- **可以先不做**：诊断、命令、输出通道、进度、状态栏、bulk edit、webview、SCM、task、terminal，以及 chat / notebook / testing / MCP 全部。
- **两个翻译点**：`$provideHover(handle, resource, position, context, token)` 的 `position` 是 **1-based**，而 seam 要 **0-based UTF-16**；返回的 `contents` 是 `IMarkdownString[]`，要拼成 seam 的 `hover.contents: string`。

### 2.4 真的 VS Code 扩展（`vscode-languageclient`）额外要什么（侦察 ad6674db 二轮，读的是库的发布产物）

- **`client.start()` 实际注册 12 个 provider**：completion、**hover**、**definition**、references、documentSymbol、documentHighlight、documentLink、codeAction、rename、color、foldingRange、selectionRange（formatting 被 css 用 `provideFormatter:false` 关掉）。⇒ 主线程的 `$registerXxx` 面是这 12 个 + `$unregister`，**其中 hover / definition 正是我们要的查询入口**。
- **`vscode.version` 必须存在且满足 `^1.91.0`**：`LanguageClient` 构造期就 `checkVersion()`，不满足**构造即抛**（早于任何注册）。
- **`MainThreadOutputService` 从"可选"升为必需**：start 期的日志路径就会 `createOutputChannel(name, {log:true})`，而且必须是个完整的 LogOutputChannel（`logLevel` / `onDidChangeLogLevel` / `trace|debug|info|error|appendLine|show`）。
- **语言服务器是 VS Code 扩展自己 fork 出来的子进程**：css 用 `{module, transport: TransportKind.ipc}` 且不设 `runtime` ⇒ `cp.fork(...)` + `--node-ipc`。所以 **server 也必须编译出来**，且 `options.cwd` 来自 `workspace.workspaceFolders[0]` ⇒ **我们推的 `$initializeWorkspace` 的 folders 直接决定 server 的 rootUri/cwd**。
- **`client.start()` 自己会产生配置读取**：`synchronize.configurationSection: ['css','scss','less']` ⇒ 三次 `getConfiguration` + 一条 `didChangeConfiguration`。
- **server 声明的同步方式是 `Incremental`**：首帧全文来自 `$acceptDocumentsAndEditorsDelta` 的 `lines`；之后编辑要推真实增量 + 单调递增 `versionId`。（第一条链是只读静态文件，这条暂时用不到。）
- **start 之后库会把已匹配的文档补发 `didOpen`** ⇒ 主线程只要在 start 前把文档推进去，不需要自己触发 open。
- 好消息：`vscode` 模块本身（`Range` / `Diagnostic` / 那 10 个被 `extends` 的基类…）**是扩展宿主自己的事**，上游的 `require` 拦截器会装好——我们不实现 API，只实现主线程那面。
- 附带：`vscode-languageclient@10.0.0-next.22` 的 tarball 已被侦察取到本地（`/tmp`，sha512 与 lockfile 一致），所以"装依赖"不必依赖网络，可离线做。

### 2.5 素材：设计里点名的四个扩展，现在**跑不起来**（三份侦察一致）

- css / html / json / markdown 的可加载入口磁盘上**都不存在**（`client/out/node/*ClientMain.js`、`dist/browser/*`、markdown 的 `out/extension.js` 都缺）；`vscode-languageclient`（css/json/html 要 `^10.0.0-next.22`）**全盘未安装**。
- 而且 css / json / html 的 hover / 格式化**不是 VS Code 扩展源码注册的**，是 `vscode-languageclient` 的 `client.start()` 内部注册（css `client/src/cssClient.ts:103`）⇒ 光有协议还不够，还得先把这个 VS Code 扩展**构建出来**，并满足 languageclient 起语言服务器时要的主线程调用。
- 已装的 cSpell **不能用来验"问一次查询"**：它 server 声明的 capabilities 只有 `openClose` 文档同步 ＋ `quick fix` 代码动作——seam 那四个操作一个都没有。
- 网络是通的（registry 200），所以"`npm install` 再编译"这条路在环境上可行（prac 仓自己被 `devEngines` 限制用 pnpm，跟 `.build/vscode` 无关）。

## 3. 三个裁决（James，2026-09-21）

> 原话：① **A**；② **vscode 生态应依托扩展宿主**；③ **利用 vscode-embed**。下面是它们各自否掉了什么、推出什么。

**① 素材 = A（内建 css / json / html）。** 不走"自写最小的 VS Code 扩展先把协议验掉"那条——直接用真的 VS Code 扩展。代价照认：得先把 VS Code 扩展编译出来，而且它的 provider 是 `vscode-languageclient` 在 `start()` 里注册的（12 个），主线程面要一次到位。

**② 生态依托扩展宿主。** 能力要从**扩展宿主里跑着的真的 VS Code 扩展**来，不复刻、不旁路；扩展清单要来自**真实扫描**（内建目录 + 用户扩展目录），不是手写一两条。主干自己持有这条连接（下面 2A）。

**③ 机制落在 `vendor/vscode-embed`。** 扩展宿主这条连接是**机制**，和 `startCodeServer`、资产路由、同源代理一样进 lib；host 插件只留政策（什么时候起、给谁用）。

### 裁点 1：素材 —— **已裁：A（内建 css / json / html）**

| 选项                                       | 代价                                                                     | 能验什么                     |
| ------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------- |
| **A. 内建 css / json / html**（设计原意）  | 要先装依赖并编译**客户端与 server 两半**（现在还不可加载）；它的 provider 是 languageclient 在 `start()` 里注册的（12 个），还要输出通道、文档、工作区 folders 都到位 | 生态能用（终态要的）         |
| B. 已装的 cSpell                           | 零构建                                                                   | **验不了查询**（它没有那四个操作），只能验激活与文档同步 |
| **C. 自写一个最小的 VS Code 扩展**（直接 `registerHoverProvider`） | 要写十几行并放进扩展目录                                     | 协议通没通（回答是自己造的） |
| D. 装一个市场语言扩展                      | 要 James 授权装 VS Code 扩展                                                      | 生态能用                     |

**建议**：**先 C 再 A**。C 把"协议实现"和"构建前置"两个风险分开；B1 也独立指出直接用 css-language-features 风险高得多。

### 裁点 2：扩展宿主从哪来 —— **已裁：主干自己持有这条连接（2A），扩展清单来自真实扫描**

| 路线 | 做法 | 代价 | 依赖 |
| ---- | ---- | ---- | ---- |
| **2A. 主干自己 fork**（IPC 管道载体） | `cp.fork(bootstrap-fork.js, …, {env:{VSCODE_ESM_ENTRYPOINT, VSCODE_EXTHOST_IPC_HOOK:<我们建的 unix socket>}})` | initData 里的扩展清单要我们自己造（第一条链手写一两条即可） | 不依赖 code server，天然满足"页面关着也能用" |
| 2B. 连 code server 的 ExtensionHost 口 | 对 `/oss-<commit>` 发 `ConnectionType.ExtensionHost`，复用服务端的 fork 与 VS Code 扩展扫描 | 要反推 remote agent 那套握手（token、socket 帧） | 依赖 code server 在跑 |

**建议 2A**：未知更少、不依赖服务端内部；两条路的协议层完全一样，以后要换只换载体。

### 裁点 3：协议层怎么来 —— **已裁：机制落进 `vendor/vscode-embed`**

| 选项 | 代价 |
| ---- | ---- |
| **3A. import `out-build/`** | 零新构建机制（它本来就是我们的构建产物）；但**没有类型**，要自己给用到的那点写声明 |
| 3B. 从上游源码编一个小 bundle（带 `.d.ts`） | 类型完整；多一套构建步骤 |
| 3C. 自己重写帧编码 | 要复刻帧头、短/长字符串、JSON 与 Mixed 两种序列化——成本最高、最容易踩坑 |

**建议 3A**，踩坑再退 3B。

## 4. 实施步骤（按 2026-09-21 的三个裁决）


1. **让VS Code 内建扩展变成可加载的**（独立可验，不碰协议）：给 `extensions/css-language-features` 与它的 `server/` 各装依赖，再编译 client 与 server 两半。**验收**：`client/out/node/cssClientMain.js` 与 `server/out/node/cssServerMain.js` 存在，且 `vscode-languageclient` 从扩展目录能解析。
2. **连接与协议写进 `vendor/vscode-embed`**（机制，不带政策）：建载体（`VSCODE_EXTHOST_IPC_HOOK` 管道）→ `cp.fork(bootstrap-fork.js, …)` → 固定顺序握手（`Ready` → initData → `Initialized`）→ import `out-build` 的 `RPCProtocol` 与 id 表，落成一个可复用的入口；host 插件只决定"何时起、给谁用"。
3. **主线程最小接口**（同在 lib 里）：§2.3 那批必需顾客（含 `MainThreadStorage`、`MainThreadOutputService`，以及 §2.4 那 12 个 `$registerXxx`）＋ 初始化推送 ＋ 文档推送。**验收**：css 扩展真的激活、`$registerHoverProvider` 到达主线程。
4. **扩展清单来自真实扫描**：扫VS Code 内建扩展目录与用户扩展目录，构造 initData 的 `extensions` 快照（第一条链可以让只有 css 进 `myExtensions`，但清单本身必须是扫出来的）。
5. **问一次查询**：主线程调 `$provideHover`（VS Code 侧 1-based → seam 的 0-based），翻成 `{kind:'hover'}`。**验收**：拿到 CSS 属性的真实文档。
6. **接进 agent 侧**：写 provider、在 prac 的 bundle patch 里插 `@deepseek-ai/dsh-lsp` 与插件行，用 `lsp` 工具问一次。
7. **生态验证**：把 cSpell 也走通（诊断 / 文档同步那条），确认多个扩展、多个提供方并存。

## 5. 怎么验证

- **没有页面**：整条链在 headless（`pnpm dsh --profile prac-dev --port 3084 --no-open`，不开页面）下跑通——这本身就是设计要的那条（`docs/architecture.md:49`）。
- **不是手配的**：profile 里**没有任何 `dsh-lsp-stdio` 的 servers 配置**；查询由扩展的语言服务回答（第 5 步用只有它才答得出的内容验，例如 CSS 属性的文档）。
- **agent 侧**：`lsp` 工具走通（1-based 入参、有结果或 `No results.`）。
- **不回归**：`verify-layout` 14 · `verify-views` 28 · `verify-focus` 9 · `verify-regions` 6 · `verify-view` 7 · `verify-file` 33 · `verify-extension`（带 `EXTENSION=… VIEW=none`）；prac 侧 `verify:stack` / `verify:bottom` / `verify:persistence` / `verify:split`；`pnpm test`。
- **反例**：不推 `$initializeWorkspace` ⇒ 扩展激活挂住（证明喂的东西是必需的）。

## 6. 风险与还没定的

1. **id 表必须与跑着的 ext host 同源**：我们 import 的 `out-build` 与 ext host 用的 bundle 都出自同一次构建（同一个 commit），但要**实测核对**（两边都能打印 `ProxyIdentifier.count === 168`），否则会静默错位。
2. **`out-build` 里的 `window`**：`mainThreadExtensionService.js` 这类要 `window`；我们只 import 协议层与少数几个，其余自己按 shape 实现（不 import 主线程类）。
3. **VS Code 内建扩展的构建**：`extensions/ipynb` 那条 typecheck 曾经挡住整个 extensions 构建（umbrella §4 #10）；**定向编译单个 VS Code 扩展绕得开**——css 就是用 checkout 自带的 `tsc` 直接编出来的（client 与 server 两半都成了），没碰 ipynb。
4. **VS Code 扩展扫描**：第一条链手写扩展清单；要变成"用户装什么就能用什么"，得有一个扫描器（上游 `out-build` 里有没有可直接用的，未查）或走 code server 的 HTTP 面。
5. **多提供方并存时的扩展名冲突**：`lsp-stdio` 与我们若都声明 `.ts`，后注册者抛 `LSP_CONFLICT`，要在 patch 层二选一或分扩展名。
6. **两条链要不要合成一条** —— **已定（James 2026-09-21）：不合并**。agent 侧一个工作区一个宿主（同工作区的 agent 共用），UI 按上游每个页面一个宿主，两者不共用。想把 UI 也接到同一条链上，得先解决"谁是唯一主线程 + UI 的 VS Code 扩展界面贡献怎么呈现"，那是另一个决定。
7. **agent 侧的启用策略已经有落点**（2026-09-21 后补，不在这条链的验收里）：全局层 `$XDG_CONFIG_HOME/prac/settings.json` + 工作区层 `<workspace>/.agent/prac/settings.json`（与 UI 分离、模型同构：作用域 / JSONC / key 用上游标识符 / 优先级都照 VS Code），挂在宿主 init data 的 `myExtensions` 上，并桥进宿主的配置模型（`userRemote` / `workspace` 两层）⇒ 以后不必再发明「给 agent 装什么」的机制，也不必发明「agent 怎么读配置」。见 `docs/architecture.md` §3.3/§7 #4。
8. **工作区级的 memento 现在不可用（已发现，未定要不要补）**：`workspaceStorage/<hash>/` 下**只有 `vscode.lock`、没有 `meta.json`**（连 UI code server 自己建的目录也没有），而那份 `meta.json` 是上游在**目录首次创建时**写的（`api/common/extHostStoragePaths.ts:57-76`）⇒ 扩展宿主的文件系统消费方（`vscode.workspace.fs` 那一半）在我们这个最小主线程里没落地：我们只实现了语言功能要的 actor，其余由兜底 actor 答 `undefined`。**后果**：`workspaceState` 这类工作区级存储对扩展静默失效（`globalStorage` 不受影响，那是纯 node 文件写）。**不影响语言功能**；要不要为"扩展能正常工作"补上，待 James。

## Related

- [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：umbrella。
- [../in-progress/2026-09-19-architecture.md](../in-progress/2026-09-19-architecture.md)：设计怎么从需求推出来（§4.2 是这条链的落点）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：目标设计（§4.2 语义服务、§5.2 谁起谁关、§7.1 第一条链）。
- [../../../docs/vscode.md](../../../docs/vscode.md) / [../../../docs/dsh.md](../../../docs/dsh.md)：两个系统的内部结构（事实参考）。
