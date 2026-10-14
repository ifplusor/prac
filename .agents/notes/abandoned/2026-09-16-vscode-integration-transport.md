---
status: abandoned:superseded
---

# Agent Note: VS Code 集成进 prac 的通信协议

> **状态：作为计划已被取代**（2026-09-19「从需求出发重做架构」，见 [../in-progress/2026-09-19-architecture.md](../in-progress/2026-09-19-architecture.md)）。这份 broker 设计现在是那条架构里的 **P1**（主干自己当主线程），内容不作废；协议事实已归入 [`docs/vscode.md`](../../../docs/vscode.md)。
>
> 下面的数字与行号都指 pinned VS Code **1.137.0** checkout 与 DSH checkout（事实核实于 2026-09-16 / 09-17）；更细的依据（协议清单、踩坑、决定台账）在[工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md)。

## 问题

prac 的目标（`docs/architecture.md` §1.2）要求：**IDE 能力在 server 侧**（agent 要能用），**UI 组件在 client 侧**。而 VS Code 的两个半边按它自己的切法通信（渲染器 ↔ code server），中间还有一层"主线程 ↔ 扩展宿主"的关系。

现状是**透传**（`/prac-vscode` 静态 + 把 VS Code 自己的 WS/HTTP 原样转发），浏览器直接讲 VS Code 的协议 ⇒ 能力与状态被页面把关，agent 够不着。这正是 [umbrella §4](../in-progress/2026-09-09-vscode-dsh-integration.md) 里那两行差距：**两半之间的通信层还是透传**、**client 侧嵌的是整个 workbench app 而不是 UI 组件**。

要设计的是：**两半之间走什么、谁回答什么、消息什么形状。**

## 背景

### 两半与三个角色

```mermaid
flowchart LR
  subgraph D["桌面"]
    direction LR
    subgraph DR["渲染器（进程）"]
      direction TB
      DUI["workbench（UI 层）"]
      DMT["主线程：MainThread* 的实现"]
      DPS["平台服务"]
      DUI --- DMT --- DPS
    end
    DEH["扩展宿主（进程）<br/>ExtHost* · 扩展代码 · 无 DOM"]
    DR <-->|"成对：MainThreadXxx ↔ ExtHostXxx<br/>一侧一个，以宿主发起为主"| DEH
  end
  subgraph R["远程（我们的形态）"]
    direction LR
    subgraph RR["渲染器 = 浏览器页"]
      direction TB
      RUI["workbench（UI 层）"]
      RMT["主线程：MainThread* 的实现"]
      RPS["平台服务"]
      RUI --- RMT --- RPS
    end
    subgraph CS["code server 进程"]
      REH["扩展宿主<br/>ExtHost* · 无 DOM"]
    end
    RR <-->|"同一套配对"| REH
  end
```

**渲染器**跑 workbench（UI）；**扩展宿主**跑扩展代码（只有 `vscode.*` API，没有 DOM），在另一个进程；**主线程**不是线程，是扩展宿主协议的另一端——在 workbench 里替扩展宿主做 UI / 编辑器 / 存储 / 诊断的那套实现（`api/browser/**` 的 `@extHostNamedCustomer`）。**两种形态下主线程都在渲染器里**，远程形态搬走的只有扩展宿主。

**对 prac 的意义**：扩展宿主能拿到的（文档、诊断、语言特性、搜索、终端、任务）是 **tier S**；只有主线程能答的（可见编辑器与选择、对话框、quick pick、进度）是 **tier C**——而主线程住在页面，所以今天"页面不在 ⇒ 没有能力"。broker 要做的，就是把主线程这一角色从渲染器搬到 server 侧（形状见「设计」，最小面见「证据」）。

> 角色表与图、`MainThread*` 的实现清单与计数、平台服务层（`src/vs/platform/**` 是什么、DI 怎么来、主线程用到 42 个 / 166 处）、协议与载体（帧格式与 12 种消息、桌面 utility 进程 + MessagePort、远程 WS + fork 桥）都在 [`docs/vscode.md`](../../../docs/vscode.md)。

### 上游协议（设计只依赖这些）

- **code server 一个 HTTP 端口 + 同一端点上按首消息分三型的 WebSocket**：Management / ExtensionHost / Tunnel，各自一条连接，靠 `?tkn=` 与握手鉴权。设计用到前两型——**Management 面**由服务端注册 channel（`remotefilesystem`、`extensions`、`telemetry`、`logger`…**没有 diagnostics channel**，marker 在渲染器的 `IMarkerService`）；**ExtensionHost 面** fork 扩展宿主，并把它与服务器之间的管道/socket 桥到这条 WS。细节见工作记录·「code server 的协议」。
- **扩展宿主协议**（`api/common/extHost.protocol.ts`）：168 个代理标识 = `MainContext` 87 + `ExtHostContext` 81；`MainThreadXxxShape` 86 个接口 / 500 个 `$` 方法；**主线程的那 87 个实现全在渲染器里**，协议之外没有任何可复用的服务端实现。

### 关键结构约束（设计就是围着它转）

1. **主线程对端是渲染器**。扩展宿主的一切（开文档、语言特性、诊断、命令）都要一个"主线程"回答，而上游的实现全在 `src/vs/workbench/api/browser/**`。
2. **扩展宿主由渲染器发起**：只有 `desiredConnectionType === ExtensionHost` 的连接才会 `new ExtensionHostConnection` 并 fork 进程 ⇒ **没有页面就没有扩展宿主**，也就没有任何扩展能力。
3. **DSH 的反向能力很窄**：remote 面是"host 声明方法、client 调用"；host→client 只有**转发事件**（`emit` 通知 / `waterfall` 可带回答），且**只有一个源**、由 DSH 的组装注册；流复用 `/api/remote.mux` 是**单向推送**（见「证据」·tier C 的载体）。

## 设计（broker：server 侧扮演主线程 + 三层回答）

### 形状

```mermaid
flowchart TB
  UI["VS Code UI 组件"]
  subgraph SV["server：VS Code 插件的 server 半边 = broker"]
    B["broker"]
    CS["code server（Management 面）"]
    EH["扩展宿主（ExtensionHost 连接）"]
    AG["agent 的工具（进程内直调，无额外协议）"]
    B -->|"① 拿它注册的 channel"| CS
    B -->|"② 扮演主线程"| EH
    B -->|"③ 把两侧合成能力"| AG
  end
  UI <-->|"DSH remote：能力面快照 / 调用 · 转发事件 waterfall + $events/result"| B
```

### prac 版对照（框位对着官方图；**这是我们的整理，不是上游原图**）

官方图：[Supporting Remote Development](https://code.visualstudio.com/api/advanced-topics/remote-extensions#architecture-and-extension-kinds) 的 architecture.png（本地 Extension Host / VS Code Server / Remote Extension Host 三块）。

图例：**[已落地]** 今天就是这样 · **[要搬]** 目标里换到 server 侧 · **[要建]** 目标里才有的框

```mermaid
flowchart LR
  subgraph CL["浏览器（client 端）"]
    direction TB
    F["prac frame / 编排 / 注意力<br/>[已落地]"]
    U["VS Code UI 组件<br/>今天 = 整个 workbench app<br/>[要搬]"]
    P["client 半边插件 prac-client-vscode-host<br/>今天兼主线程 [要搬]"]
    CAP["能力面快照 / 调用<br/>editors · diagnostics"]
    F --> U --> P
    P --- CAP
  end
  subgraph SV["DSH host（server 端，主干）"]
    direction TB
    H["prac-host-vscode<br/>路由 · 同源代理 · 起停 code server [已落地]"]
    CS["code server 进程（1 个 · 动态端口）<br/>Management · ExtensionHost · Tunnel"]
    B["broker：扮演主线程 [要建]<br/>18 代理 / 82 方法 · tier S / C / X"]
    EH["扩展宿主 Remote Extension Host<br/>工作区扩展 · 文档权威 [要建]"]
    AG["agent 的工具：进程内直调 [要建]"]
    H --> CS --> B --> EH
    B --> AG
  end
  CAP <-->|"今天：VS Code 自己的 WS / HTTP 透传 [要换]<br/>目标：DSH remote + 转发事件 + waterfall $events/result"| B
```

对照表（官方图的每一块，在 prac 里对应什么）：

| 官方图 | prac 今天 | 目标 |
| --- | --- | --- |
| **VS Code Client（UI）** | 整个 workbench app 嵌进 prac 的 part host | 拆成 **UI 组件**（编辑器控件 / 视图 / 对话框），由能力面快照驱动 |
| **本地 Extension Host（UI 扩展）** | **没有对应物**：只有一个远程扩展宿主 | tier C 里"只有页面能答"的那些（可见编辑器与选择、对话框、quick pick、进度）由 client 半边答；要不要真的起一个 UI 扩展宿主，本文没定 |
| **VS Code Server** | `out-vscode-reh` 进程（已由主干起停） | 不变；broker 作为**客户端**连它的 Management 面 |
| **Remote Extension Host（工作区扩展）** | 由**页面**发起连接才 fork | 由 **broker** 发起 ⇒ 页面刷新不再重启扩展宿主 |
| **（官方图没有这一块）** | 渲染器**就是**主线程 | **broker 扮演主线程**（最小面见「证据」） |
| **（官方图没有这一块）** | agent 够不着任何 IDE 能力 | broker 的能力**直接注册成 agent 工具**（进程内，无协议） |

### 两条连接（①②）与三层回答（tier S / C / X）

**① 与 code server 的连接**：broker 作为**客户端**连 code server 的 Management 面（走它自己的握手与 RPC），拿它已经注册的那些 channel。这部分**不需要重新设计**——它天生就在 server 侧。

**② 与扩展宿主的连接**：broker 发起 ExtensionHost 连接并 fork 扩展宿主（**不再由页面发起**），然后按三个 tier 回答：

| tier | 内容 | 谁回答 | 怎么走 |
| --- | --- | --- | --- |
| **S（server 自己答）** | 文档内容与版本、语言特性与诊断、文件系统、工作区文件夹、搜索、任务、调试、终端 | broker | 进程内直答；同一批能力**直接注册成 agent 工具** |
| **C（转发给 client）** | 可见编辑器与选择、UI 提示（对话框 / quick pick / 进度）、编辑器装饰、窗口状态 | client 半边 | 经 DSH 的**转发事件 waterfall**（下节） |
| **X（明确拒绝）** | 既不该 server 答、client 也不会答的 | broker | **返回明确错误**，不许静默挂起（"装扩展永久挂住"就是反例） |

### DSH 上的通道与消息形状

- **能力面**（结构化数据）：DSH 的 remote 面——broker 声明方法，client 调用；状态变化用**转发事件**推送；`snapshot / subscribe / settled / version / actions` 五件套复用（`docs/architecture.md` §4.4 原则 3）。
- **tier C 的"host 问 client"**：DSH 的反向只有转发事件，其中 `waterfall` 带 `eventId` 与请求载荷、client 用一元调用 `$events/result` 回答（见「证据」·tier C 的载体）。所以走**转发事件的 waterfall**，不是自定义双工流（后者在这套协议里表达不出 host→client 的请求）。消息集合：

  | 消息 | 方向 | 字段 |
  | --- | --- | --- |
  | `call` | host → client | waterfall 事件：`{eventId, method, params}` |
  | `result` / `error` | client → host | `$events/result`：`{eventId, value}` / `{eventId, code, message}` |
  | `event` | host → client | `emit` 事件：`{topic, payload}` |

  规则：`eventId` 关联单次请求；`method` 是白名单（只允许 tier C 的方法）；**未知 method 必须回 error**，不许忽略。

### 文档权威

**权威在 broker，client 只做渲染副本**（tier S 的写路径）：

| 消息 | 方向 | 字段 |
| --- | --- | --- |
| `applyEdits` | client → host | `{uri, baseVersion, edits}` |
| `applied` | host → client | `{uri, version}` |
| `rejected` | host → client | `{uri, reason}`（版本不符 ⇒ client 重新拉 `snapshot`） |
| `changed` | host → client | `{uri, version, edits}`（外部改动，如 agent 写入） |

client 做**乐观回显**（本地先应用，等 `applied` 确认版本）；版本号单调，**错序与陈旧一律丢弃**。

上游的方向与这条**相反**（具体事实与出处见「证据」·文档），所以 broker 持权威 = 它要**接管推送侧**，并自己有一个文本模型——上游**没有** server 侧的文档模型可复用。

上面那张表只是 **client ↔ broker** 那一半；扩展宿主侧的推送是另一趟（「证据」1 表里那几行 `accept*`），两张要一起读。

**这条决定要一起接受的三个漏洞**（也就是「待裁」2 选项 ① 的代价）：

1. **版本分叉**：权威版本在 broker；client 的 `baseVersion` 只覆盖"它看过的那次"。broker 在收到 `applyEdits` 之前若已推过 `changed`，本地回显就与权威分叉——只能靠 `rejected` + 重拉收敛，表现是打字时文本跳变。
2. **位置型 edits 没有变换**：`applyEdits` 带的是 offset/range，而并发（扩展改写、agent 写入）会让位置失效。要么 broker 做变换（OT 级工作量），要么退化成整篇替换（长文件延迟高）。草案没写这一层。
3. **`applied` 不等于写盘**：`applied` 是内存版本确认；写盘是 `$trySaveDocument`（`extHost.protocol.ts:296`）那一趟，保存的时机、失败回执、与脏标记的关系草案都没写。

### 生命周期与重连（这条是设计的直接收益）

- broker 拥有扩展宿主 ⇒ **页面刷新/断线不再重启扩展宿主**。今天扩展宿主按 `reconnectionToken` 每连接一个，页面一刷新就换一个。
- 页面（重）连时：拉能力面 `snapshot` → 订阅事件 → 按需重建 UI 组件（原草案的 `hello` 握手随双工流一起作废，见「备选」F）。**权威状态全在 server，页面只是视图**。
- agent 侧同一时刻直调同一批能力对象，**不需要协议**——这是"能力在 server"的兑现方式。

## 证据

### 1. "broker 扮演主线程"的最小面：**18 个代理 / 82 个方法**起步

**启动到"可激活"不需要主线程实现任何东西。** init 是**主线程推给扩展宿主**的：`ExtHostConfiguration.$initializeConfiguration`（`extHostConfiguration.ts:126`）、`ExtHostWorkspace.$initializeWorkspace`（`extHostWorkspace.ts:268`）、`ExtHostTelemetry.$initializeTelemetryLevel`（`extHostTelemetry.ts:86`）；扩展宿主的 `initialize()` 卡在 `waitForInitializeCall()`（`extHostExtensionService.ts:242` → `extHostWorkspace.ts:274`）。⇒ broker 先要会**发**这三条，而不是实现什么。

**激活路径上扩展宿主往外只调两个代理**：`MainThreadExtensionService.$activateExtension`（`extHostExtensionService.ts:193`）、`MainThreadErrors.$onUnexpectedError`（`extensionHostMain.ts:52,156`）。

两点语义要分清（都有出处，见 [`docs/vscode.md`](../../../docs/vscode.md)）：① **远程形态下激活不等主线程的回答**——`$onWillActivateExtension` 在 `isRemote` 时发了不等（`extHostExtensionService.ts:445-455`），所以没有页面，扩展照样激活、照样能自己 `set()` 诊断；② 但 **UI-kind 的扩展激活被交给主线程**（`:193`，`isHostExtension`）——没人答就**永久挂住**，这正是 tier X 要明确报错的那个现象。另外**产生诊断的不只是扩展宿主**：任务 / 设置 / notebook / prompt / MCP 这些 owner 直接写在渲染器里（清单见 `docs/vscode.md`）⇒ 扮主线程就得自己产生它们，或者明确划进 tier C/X。

**按验收（无页面也能拿诊断与文档）补的**：

| 面 | 代理 | 方法数 | 证据 |
| --- | --- | --- | --- |
| 激活与错误 | `MainThreadExtensionService` / `MainThreadErrors` | 8 / 1 | 上一段 |
| 文档（扩展侧请求） | `MainThreadDocuments` | 3 | `$tryCreateDocument/$tryOpenDocument/$trySaveDocument`（`extHost.protocol.ts:294-297`） |
| 诊断 | `MainThreadDiagnostics` | 2 | `$changeMany/$clear`（`:254-257`），调用点 `extHostDiagnostics.ts:170` |
| 文档推送（**主线程 → 扩展宿主**） | `ExtHostDocuments` 侧接收 | 4 | `$acceptDocumentsAndEditorsDelta`（`mainThreadDocumentsAndEditors.ts:366`）、`$acceptModelChanged`（`mainThreadDocuments.ts:114`）、`$acceptModelSaved`/`$acceptDirtyStateChanged`（`extHost.protocol.ts:2401,2402`） |

**诊断这条线是推-only**：触发在扩展手里（它自己监听文档事件后才 `set()`），协议两侧都**没有**「拉」的请求方法——拉只有读本地（扩展宿主的 `languages.getDiagnostics()`、渲染器的 `IMarkerService.read()`）。⇒ broker 自己就是那份 store：agent 的「拉」= 读 broker 的 store（同步、无协议）；同时 broker 要把**别人**的 marker 经 `$acceptMarkersChange` 回推给扩展宿主，否则扩展里的 `getDiagnostics()` 不全。上游细节（触发点、`origin`、上限、`modelVersionId`）见 [`docs/vscode.md`](../../../docs/vscode.md) 的「诊断这条线」。

**量级**：`ExtensionService 8 + Errors 1 + Documents 3 + Diagnostics 2 + Languages 5 + Configuration 2 + Workspace 20 + Commands 5 + MessageService 1 + Telemetry 2 + Storage 3 + SecretState 4 + BulkEdits 1 + FileSystem 12 + OutputService 5 + Window 3 + Progress 3 + StatusBar 2` = **18 个代理 / 82 个方法**。若扩展还注册语言特性，加 `MainThreadLanguageFeatures`（**47**）⇒ **19 个 / 129 个**。占全集（86 个 `MainThreadXxxShape` / 500 个 `$` 方法）约 **21% / 16%**（扩到 19 个代理时约 **22% / 26%**）。

**边界（必须先有）**：① 三条启动推送；② `ExtensionService` + `Errors`（激活本身与错误上报）；③ 文档三条请求 + 诊断两条（验收 1/3）。其余按扩展实际调用的 API 补齐；**没有任何一条是"纯 UI 才能激活"**。所以 tier 的划线是**按代理**，不是按机制。

### 2. tier C 的载体：`/api/remote.mux` 的流是单向的

`/api/remote.mux` 是 Typert Remote 的**流复用**（`REMOTE_STREAM_MUX_PATH`，`packages/api/gateway/src/stream-protocol.ts:6`；服务器 `RemoteStreamMuxServer` + `handleUpgrade`，`gateway/src/index.ts:206,220`）。流的方向是**单向的**：client → host 只有 `open` / `cancel`（`stream-protocol.ts:245,250`），host → client 是 `item` / `error` / `end`（`:261-263`）——**开流之后没有 client → host 的在带消息**。定帧是我们能定的，"双向"不是。

**现成能表达"host 问 client"的是转发事件里的 waterfall**：`{type:'waterfall', event, eventId, agentId, request}`（`:50-56`），client 用**一元 Remote 调用** `$events/result` 回答案（`:12`，处理点 `gateway/src/index.ts:357`）——有 `eventId` 关联，够做请求/响应。两份代价已核实：

- 转发源**只有一个**，由 DSH 的组装注册：`registerRemoteEvents` 第二次注册直接抛 `already registered`（`gateway/src/index.ts:237-248`），唯一调用点是 `packages/api/remotes/src/index.ts:41`；
- 白名单是**静态数组**：`API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts:16`，每项 `{event, mode: 'emit'|'waterfall'}`）。要塞我们的 tier C 方法进去，**必须改 DSH 的 `api-remotes`**（加数组项 + 客户端监听），不是插件本地能加的。
- 另外 waterfall 帧带 `agentId`，即它面向**按 agent 分区**的事件；prac 的 broker 是否总在某个 agent 作用域内，本文没有核实（列进"未能证实"）。

### 3. 文档：今天渲染器持有 model

**今天渲染器（主线程）持有 model，扩展宿主是镜像**：内容与脏标记由主线程推给扩展宿主（「证据」1 表里那 4 个 `accept*`），扩展宿主只会**请求**开/存/建（`MainThreadDocuments` 的 3 个方法）。所以"server 持有权威文档"= broker 要**接管推送侧**（实现那 4 个 `accept*` 的调用方），并自己有一个文本模型——上游**没有** server 侧的文档模型可复用。

### 本节没能证实的

- waterfall 的 `agentId` 是否覆盖 prac broker 的场景（它面向"按 agent 分区"的事件）；`prac` 的 client 是否是"某个 agent"的 client。
- `$events/result` 的**超时/取消**语义（只有 `cancel` 帧的字段，没查它的服务端处理与默认超时）。
- 18 个代理的**实际调用频率**：数字来自协议接口，不是运行时采样；cSpell 这种扩展可能比"最小集"多调、也可能少调。
- DSH 侧"插件注册 Typert 端点"的**完整签名与生命周期**（只确认了 gateway 有端点分发与 `registerRemoteEvents`，没读 typert 的注册 API）。
- 上游是否有**第二个** headless 主线程实现（只按 `@extHostNamedCustomer` 的实现位置判定；协议之外的路径没穷举）。

## 备选

| 方案 | 为什么不行 / 代价 |
| --- | --- |
| **A. 完整实现主线程**（87 个 `MainContext` 标识 / 500 个 `$` 方法） | 成本高且要跟着上游漂移；但**方向是对的**，我们按 tier 只做子集（最小 18 个代理，见「证据」） |
| **B. 保留渲染器当主线程**（今天的形态） | 能力与状态被页面把关，agent 够不着——正是要消除的 |
| **C. 不用扩展宿主，自建能力**（自己跑 LSP、自己读文件） | 放弃 VS Code 的扩展生态 ⇒ 违反目标（"利用 vscode 的生态"） |
| **D. 起一个隐藏浏览器当主线程**（Playwright 之类） | 荒谬：为了不实现协议而跑一个浏览器 |
| **E. 让 client 直接讲 extHost 协议**（经 DSH 透传） | 等于把 87 个 `MainContext` 标识的实现搬到浏览器，还让协议跨越 CS 边界 |
| **F. 自定义双工流当 tier C 载体**（本文原推荐） | **已否**：`/api/remote.mux` 的流是单向推送，client 只有 `open`/`cancel`（见「证据」·tier C 的载体） |

## 待裁

1. **broker 的边界** —— 由 server 半边扮演主线程、按 tier 回答。
   - 选项 ①（推荐）：**一次做齐 18 个代理**（激活 + 文档 + 诊断 + 工程面），页面只留 UI。代价：18 个代理要跟上游漂移；收益：验收 1–3 一次到位。
   - 选项 ②：**分两步**——先 6 个（三条启动推送 + `ExtensionService` + `Errors` + `Documents` + `Diagnostics`，够验收 1/3），UI 面继续走今天的透传。代价：两套通道并存一段时间。
   - 选项 ③：只做 tier S 的核心（文档/诊断），其余一律回 tier X 错误。代价：扩展一调 `window.*`、`commands.executeCommand` 就炸，等于只跑得了最窄的一类扩展。
2. **文档权威** —— broker 持有权威文档、client 只做渲染副本 + 乐观回显（`docs/architecture.md` §4.2 已经把"编辑器缓冲区与模型"判给 server，所以这一条问的是**怎么做**，不是要不要）。
   - 选项 ①（推荐）：**broker 权威**，并**明确接受**三件事一起做：实现 4 个 `accept*` 推送、3 个请求，broker 自带文本模型，并给位置型 edits 定变换策略（不做变换就得允许"整篇替换"这条退化路径）。三个漏洞见「文档权威」，不做的话它们就是已知故障面。
   - 选项 ②：**client 持模型**（今天的形态）+ broker 做镜像。代价：agent 看到的是镜像，与目标（能力在 server）冲突，也与 §4.2 冲突——除非只把"读"当能力、写完全归页面。
   - 选项 ③：**只在"页面没开这个文件"时 broker 才持有**（按文档粒度分工）。代价：同一文档两个权威、切换时要交权，竞态最难的一档。
3. **tier C 的载体** —— 转发事件的 waterfall + `$events/result`（原推荐的双工流已否）。
   - 选项 ①（推荐）：**加白名单**——在 `packages/api/remotes/src/remote-events.ts:16` 的数组里加 `{event, mode: 'waterfall'}`，客户端监听并用 `$events/result` 答。代价：改 DSH 的 `api-remotes`（一次），且要确认 waterfall 的 `agentId` 作用域适用（见「证据」·没能证实的）。
   - 选项 ②：**不动 DSH**，tier C 降级为"client 主动订阅 + 轮询"或"UI 提示延后/丢弃"，并在 tier X 明确报错。代价：对话框、quick pick、进度这类交互做不到位。
   - 选项 ③：**改 gateway 让流双向**（新帧 + 客户端 API）。代价：动 DSH 的传输核心，收益只是换个定帧方式，性价比最低。
4. **插件族的切分** —— broker（主线程 + 能力）与 UI 组件宿主。
   - 现状证据只够说"两边生命周期不同"：broker 要活到 code server/扩展宿主那一侧，client 半边随页面。**本文没有核实其它插件的注册面**（见「证据」·没能证实的），所以这条**只给形状、不给推荐**：
   - 选项 ①：**两个插件**（`prac-host-vscode-*` 与 `prac-client-vscode-*`），各自一行，broker 侧是新的那一族。
   - 选项 ②：**同族两半**（今天 `prac-host-vscode` / `prac-client-vscode-host` 的形态），扩展族仍是一行 + 一个 client 半边。

## 验收

1. **没有页面**时，agent 能通过工具拿到诊断与文档内容——今天的形态下不可能。
2. **页面刷新后**，扩展宿主与已打开的文档不重启（扩展不重新激活）。
3. **编辑能到扩展宿主**：client 里改一个字符，扩展（如 cSpell）在新文档版本上给出新诊断。
4. **tier X 报错**：请求不该由我们回答的东西，得到明确错误，而不是永久挂起。
5. 现有能力面（`editors` / `diagnostics`）在不改其对外形状的前提下换到新通道。

## Related

- [../../../docs/architecture.md](../../../docs/architecture.md)：§3.1（一组插件切成两半）/ §3.3（通信层，本文就是它）/ §4.2（编辑器缓冲区与模型归 server）/ §4.4 原则 3（能力面五件套）/ §5.2（VS Code 提供什么）/ §7 第 1 件（本文是它的设计）。
- [../../../docs/vscode.md](../../../docs/vscode.md)：本文背景的正文——VS Code 内部的两半、平台服务层、extHost 协议与载体。
- [2026-09-15-vscode-capabilities-into-prac.md](2026-09-15-vscode-capabilities-into-prac.md)：能力面 `Capability<T, A>` 的形态。
