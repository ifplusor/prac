---
status: proposed
---

# Agent Note: VS Code 集成进 prac 的通信协议

## Problem

prac 的目标（`docs/architecture.md` §1.2）要求：**IDE 能力在 server 侧**（agent 要能用），**UI 组件在 client 侧**。而 VS Code 的两个半边按它自己的切法通信（渲染器 ↔ code server），中间还有一层"主线程 ↔ 扩展宿主"的关系。

现状是**透传**（`/prac-vscode` 静态 + 把 VS Code 自己的 WS/HTTP 原样转发），浏览器直接讲 VS Code 的协议 ⇒ 能力与状态被页面把关，agent 够不着（偏差 5、6）。

要设计的是：**两半之间走什么、谁回答什么、消息什么形状。**

## 现有协议（2026-09-16 核实于 1.137.0 checkout）

**HTTP（同源）**：workbench HTML 与静态资源；`/vscode-remote-resource?path=…`（渲染器取文件/扩展资源字节）；`/callback`；`/web-extension-resource/*`。鉴权 `?tkn=<connectionToken>`，`--without-connection-token` 时跳过。

**WebSocket（一个端点，首消息分型，每型各开一条自己的连接）**：

| 型 | 服务端做什么 | 谁在两端 |
| --- | --- | --- |
| **Management** | `SocketServer extends IPCServer`，**服务端注册命名 channel** | 渲染器是 RPC **客户端** |
| **ExtensionHost** | `ExtensionHostConnection` **fork 扩展宿主进程**，把它与服务器之间的管道/socket 桥到这条 WS | 渲染器是 extHost 协议的**主线程**对端 |
| **Tunnel** | 按 `{host, port}` 连本机 socket 转发 | 端口转发 |

握手（三型共用）：`AuthRequest{type:'auth'}` → 服务端 `{type:'sign', data}`（vsda；native 缺失时我们跑 `--without-connection-token`）→ `ConnectionTypeRequest{type:'connectionType', commit, signedData, desiredConnectionType, args}`；服务端状态机 `WaitingForAuth → WaitingForConnectionType → Done`，**commit 不一致直接拒绝**。

管理面的 channel（服务端注册）：`remotefilesystem`、`remoteterminal`、`extensions`、`remoteextensionsenvironment`、`remoteextensionsscanner`、`userDataProfiles`、`request`、`telemetry`、`logger`、`mcpManagement`、`mcpGateway`、`sandboxHelper`、`NativeMcpDiscoveryHelper`、agentHost `RemoteProxy`、`extensionHostDebugBroadcast`。**没有 diagnostics channel**——marker 在渲染器的 `IMarkerService`。

**扩展宿主协议（renderer ↔ ext host）**：`api/common/extHost.protocol.ts`（**4218 行 / 169 个代理**），主线程侧由渲染器实现——`@extHostNamedCustomer(MainContext.MainThreadXxx)` 共 **77 个不同的 MainThread**（78 个文件）。诊断的流向是 **ext host → 渲染器**：ext host 调 `MainThreadDiagnostics.$changeMany/$changeOne`，渲染器写进自己的 `IMarkerService`。

## 关键结构约束（设计就是围着它转）

1. **主线程对端是渲染器**。扩展宿主的一切（开文档、语言特性、诊断、命令）都要一个"主线程"回答；**上游没有 headless 主线程实现**（checkout 里搜不到这类东西）。
2. **扩展宿主由渲染器发起**：只有 `desiredConnectionType === ExtensionHost` 的连接才会 `new ExtensionHostConnection` 并 fork 进程 ⇒ **没有页面就没有扩展宿主**，也就没有任何扩展能力。
3. **DSH 的反向能力很窄**：remote 面是"host 声明方法、client 调用"；host→client 只有**转发事件**（waterfall 类可带回答），没有通用双向 RPC；唯一的双向载体是**流复用** `/api/remote.mux`（插件可注册端点、自定义定帧）。

## Proposal：broker（server 侧扮演主线程）+ 三层回答

### 形状

```
client（prac 的 client 半边）
   VS Code UI 组件  ←→  DSH remote（能力面快照/调用）· 转发事件 · 一条插件自定义的双工流
                                    ↑↓
server：VS Code 插件的 server 半边 = broker
   ① 与 code server 的 Management 连接（拿 remotefilesystem / search / scm / debug / task / terminal 等 channel）
   ② 与扩展宿主的 ExtensionHost 连接（**扮演主线程**）
   ③ 把两侧合成"能力"，同时给：client 的 UI 组件（经 DSH）与 agent 的工具（进程内直调，无额外协议）
```

**① 与 code server 的连接**：broker 作为**客户端**连 code server 的 Management 面（走它自己的握手与 RPC），拿它已经注册的那些 channel。这部分**不需要重新设计**——它天生就在 server 侧。

**② 与扩展宿主的连接**：broker 发起 ExtensionHost 连接并 fork 扩展宿主（**不再由页面发起**），然后按三个 tier 回答：

| tier | 内容 | 谁回答 | 怎么走 |
| --- | --- | --- | --- |
| **S（server 自己答）** | 文档内容与版本、语言特性与诊断、文件系统、工作区文件夹、搜索、任务、调试、终端 | broker | 进程内直答；同一批能力**直接注册成 agent 工具** |
| **C（转发给 client）** | 可见编辑器与选择、UI 提示（对话框 / quick pick / 进度）、编辑器装饰、窗口状态 | client 半边 | 经 DSH 的**插件自定义双工流**（下节） |
| **X（明确拒绝）** | 既不该 server 答、client 也不会答的 | broker | **返回明确错误**，不许静默挂起（"装扩展永久挂住"就是反例） |

### DSH 上的通道与消息形状

- **能力面**（结构化数据）：DSH 的 remote 面——broker 声明方法，client 调用；状态变化用**转发事件**推送；`snapshot / subscribe / settled / version / actions` 五件套复用（`docs/architecture.md` §4.4 原则 3）。
- **tier C 的"host 问 client"**：DHS 的反向只有 waterfall 白名单，所以**用插件自定义的双工流**（`/api/remote.mux` 上注册一个端点，自己定帧）。消息集合：

  | 消息 | 方向 | 字段 |
  | --- | --- | --- |
  | `hello` | client → host | `{protocol: 1, clientId}` |
  | `call` | host → client | `{id, method, params}` |
  | `result` / `error` | client → host | `{id, value}` / `{id, code, message}` |
  | `event` | 双向 | `{topic, payload}` |

  规则：`id` 单调、单流内保序；`method` 是白名单（只允许 tier C 的方法）；**未知 method 必须回 `error`**，不许忽略。
- **文档编辑**（tier S 的写路径）：**server 持有权威文档**（扩展宿主那一份），client 的编辑器控件持有**渲染副本**。

  | 消息 | 方向 | 字段 |
  | --- | --- | --- |
  | `applyEdits` | client → host | `{uri, baseVersion, edits}` |
  | `applied` | host → client | `{uri, version}` |
  | `rejected` | host → client | `{uri, reason}`（版本不符 ⇒ client 重新拉 `snapshot`） |
  | `changed` | host → client | `{uri, version, edits}`（外部改动，如 agent 写入） |

  client 做**乐观回显**（本地先应用，等 `applied` 确认版本）；版本号单调，**错序与陈旧一律丢弃**。

### 生命周期与重连（这条是设计的直接收益）

- broker 拥有扩展宿主 ⇒ **页面刷新/断线不再重启扩展宿主**。今天扩展宿主按 `reconnectionToken` 每连接一个，页面一刷新就换一个。
- 页面（重）连时：`hello` → 拉能力面 `snapshot` → 订阅事件 → 按需重建 UI 组件。**权威状态全在 server，页面只是视图**。
- agent 侧同一时刻直调同一批能力对象，**不需要协议**——这是"能力在 server"的兑现方式。

## Alternatives considered

| 方案 | 为什么不行 / 代价 |
| --- | --- |
| **A. 完整实现主线程**（77 个 MainThread，全集 169 个代理） | 成本高且要跟着上游漂移；但**方向是对的**，我们按 tier 只做子集 |
| **B. 保留渲染器当主线程**（今天的形态） | 能力与状态被页面把关，agent 够不着——正是要消除的 |
| **C. 不用扩展宿主，自建能力**（自己跑 LSP、自己读文件） | 放弃 VS Code 的扩展生态 ⇒ 违反目标（"利用 vscode 的生态"） |
| **D. 起一个隐藏浏览器当主线程**（Playwright 之类） | 荒谬：为了不实现协议而跑一个浏览器 |
| **E. 让 client 直接讲 extHost 协议**（经 DSH 透传） | 等于把 77 个 MainThread 的实现搬到浏览器，还让协议跨越 CS 边界 |

## Open questions（需要 James 裁）

1. **broker 的边界**：确认由 server 半边扮演主线程、按 tier 回答（推荐），还是别的分法。
2. **文档权威**：server 持有权威、client 只有渲染副本 + 乐观回显（推荐）；还是 client 持有模型、向 server 同步增量（延迟低，但 agent 看到的是镜像）。
3. **tier C 的载体**：自定义双工流（推荐，方法白名单我们定）；还是只用 waterfall 白名单事件（要改 DSH 的 allowlist，且只支持 JSON 请求/响应）。
4. **插件族的切分**：broker（主线程 + 能力）与 UI 组件宿主是不是两个插件？还是同族的两半？

## Acceptance（怎么验证设计成立）

1. **没有页面**时，agent 能通过工具拿到诊断与文档内容——今天的形态下不可能。
2. **页面刷新后**，扩展宿主与已打开的文档不重启（扩展不重新激活）。
3. **编辑能到扩展宿主**：client 里改一个字符，扩展（如 cSpell）在新文档版本上给出新诊断。
4. **tier X 报错**：请求不该由我们回答的东西，得到明确错误，而不是永久挂起。
5. 现有能力面（`editors` / `diagnostics`）在不改其对外形状的前提下换到新通道。

## Related

- [../../../docs/architecture.md](../../../docs/architecture.md)：§1.4 / §3.1 / §3.3 / §4.3 / §7（本文是 §7 第 1 件的设计）。
- [2026-09-15-vscode-capabilities-into-prac.md](2026-09-15-vscode-capabilities-into-prac.md)：能力面 `Capability<T, A>` 的形态。
- [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：决定 22、与目标架构的差距（§4）。
- [../../worklog/2026-09-09-vscode-dsh-integration.md](../../worklog/2026-09-09-vscode-dsh-integration.md)：工作记录——协议清单（工作记录·"code server 的协议"）。
