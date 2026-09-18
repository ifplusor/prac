# VS Code 的内部结构（参考）

> 这篇是 **VS Code 自身**的结构：它把工作台切成哪两半、平台服务层是什么、扩展宿主协议跑在什么载体上。
> **prac 的架构**（用它的哪种运行形态、broker 要扮演什么）在 [architecture.md](architecture.md) §5.2 与 [proposed/2026-09-16-vscode-integration-transport.md](../.agents/notes/proposed/2026-09-16-vscode-integration-transport.md)。**行号与数字指 pinned `1.137.0` checkout。**

**内部的两半**：VS Code 自己把工作台切成两半——**渲染器**（renderer）跑 workbench 的 UI；**扩展宿主**（extension host）是另一个进程、跑扩展代码，只有 `vscode.*` API，**没有 DOM、没有 UI**。扩展宿主协议的**另一端**叫"**主线程**"（main thread）——**不是线程，是角色名**（`MainContext.MainThreadXxx` ↔ `ExtHostContext.ExtHostXxx`），实现在 workbench 里，替扩展宿主做 UI / 编辑器 / 存储 / 诊断那些事。**两种运行形态下主线程都在渲染器里**，远程形态搬走的只有扩展宿主。

| 词                             | 是什么                                                                              | 桌面                      | 远程 / 浏览器                       | 上游落点                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **渲染器（renderer）**         | 跑 **workbench**（UI）的那个进程 / 页面：编辑器、视图、命令面板都在这里             | Electron renderer 进程    | 浏览器页                            | `src/vs/workbench/**`                                                                                       |
| **扩展宿主（extension host）** | 跑**扩展代码**的独立进程：只有 `vscode.*` API，没有 DOM、没有 UI                    | 主进程拉起的 utility 进程 | **code server 里** `cp.fork` 的进程 | `api/common/extHost*` + `api/node/**`                                                                       |
| **主线程（main thread）**      | extHost 协议的另一端：在 workbench 里替扩展宿主做 UI / 编辑器 / 存储 / 诊断那套实现 | 渲染器里                  | **渲染器里**（= 今天的页面）        | `api/browser/**` 的 `@extHostNamedCustomer(MainContext.MainThreadXxx)` 实现——**上游没有 server 侧的那一份** |

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

**平台服务**（`src/vs/platform/**`）是 UI 之下的**服务层**：文件、配置、存储、命令、遥测、日志、诊断，每个服务一个目录，下分 `common/` 与 `browser/`（或 `node/`、`electron-main/`）。`src/vs/workbench/**` 是 **UI 层**，主线程的 `MainThread*` 实现也在这一层；依赖单向——workbench 大量 import platform，而 **platform → workbench 的真实 import 是 0 处**。服务先由 `createDecorator<T>('id')` 换出一个服务标识（`instantiation.ts:109`），实现于启动时注册（`workbench.common.main.ts:189`），再由 `IInstantiationService` 注入（接口 `instantiation.ts:52`）；platform 下共 **233 个**服务标识。**主线程的 97 个文件里用到 42 个服务 / 166 处**：

| 服务（import 处数）                                                       | 代表 file:line                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ILogService` (22)                                                        | `api/browser/mainThreadAuthentication.ts:23`                                                 |
| `IConfigurationService` (14) · `IInstantiationService` (14)               | `mainThreadAuthentication.ts:35` · `mainThreadCLICommands.ts:16`                             |
| `IUriIdentityService` (13) · `IFileService` (7) · `ITelemetryService` (7) | `mainThreadBulkEdits.ts:11` · `mainThreadDocuments.ts:13` · `mainThreadAuthentication.ts:15` |
| `IStorageService` (5) · `ICommandService` (5) · `IMarkerService` (1)      | `mainThreadStorage.ts:6` · `mainThreadCommands.ts:8` · `mainThreadDiagnostics.ts:6`          |

扩展宿主的 `$` 调用最终就落到这些服务上。一条完整的链：`ExtHostDiagnostics` 调 `$changeMany`（`api/common/extHostDiagnostics.ts:170`）→ `MainThreadDiagnostics.$changeMany`（`api/browser/mainThreadDiagnostics.ts:69`）→ `IMarkerService.changeOne`（`:51`）/ `changeAll`（`:93`）→ Problems 视图——整条链都在渲染器里，终点是平台服务。

**扩展宿主协议与载体**：`api/common/extHost.protocol.ts`（**4218 行**）——代理标识 **168** 个 = `MainContext` **87** + `ExtHostContext` **81**；`MainThreadXxxShape` **86** 个接口 / **500** 个 `$` 方法；`ExtHostXxxShape` **81** 个接口 / **441** 个 `$` 方法（数法：标识数两个 `…Context` 表的条目，方法数 `interface XxxShape` 体内以 `$` 开头的方法，都能用一条命令复算）。**主线程那 87 个实现全部在渲染器里**：78 个 `@extHostNamedCustomer(MainContext.MainThreadXxx)` + 9 个手工注册（Documents / TextEditors / Webviews / WebviewPanels / WebviewViews / CustomEditors / NotebookDocuments / NotebookEditors / ChatOutputRenderer），全在 `src/vs/workbench/api/browser/**`——**协议之外没有 server 侧实现可复用**。

协议是 `IRPCProtocol`（`proxyIdentifier.ts:8`），实现 `RPCProtocol`（`rpcProtocol.ts:115`），两端各一个实例：一帧一消息的二进制，帧头 `uint8 type` + `uint32 req`（`:518-522`），12 种 type（`:940-953`：请求 1–4 / `Acknowledged` 5 / `Cancel` 6 / 回复 7–12），`$` 方法经 JS `Proxy` 现造函数发出（`:252`/`:461`），对端按 `rpcId` + `method` 在 `_doInvokeHandler` 里落到本地对象（`:449`）。载体被 `IMessagePassingProtocol`（`ipc.ts:99-106`）抽象掉，两端都不知道自己跑在什么上：

- **桌面**：Electron **utility 进程**（不是 `child_process.fork`）+ **MessagePort**（`localProcessExtensionHost.ts:416`，env `VSCODE_WILL_SEND_MESSAGE_PORT`；扩展宿主侧 `api/node/extensionHostProcess.ts:183-203`）；
- **远程 / web（prac 的形态）**：浏览器 `new WebSocket`（`browserSocketFactory.ts:80`）→ code server `upgradeToISocket`（`remoteExtensionHostAgentServer.ts:237`）→ `cp.fork` 扩展宿主（`extensionHostConnection.ts:290`）→ 把这条 WS 与扩展宿主的管道 / socket 对拷（`:180-183` / `:190-200`，控制消息 `VSCODE_EXTHOST_IPC_SOCKET` / `…_READY`，连接方式由 `VSCODE_EXTHOST_WILL_SEND_SOCKET` / `VSCODE_EXTHOST_IPC_HOOK` 二选一）。

**发起方永远是渲染器**：远程要渲染器发 `desiredConnectionType === ExtensionHost`（`remoteAgentConnection.ts:362`）服务端才 fork，桌面由渲染器 `createExtensionHost()`（`localProcessExtensionHost.ts:225`）让主进程起 utility 进程 ⇒ **没有页面就没有扩展宿主**，也就没有任何扩展能力。

**诊断（`DiagnosticCollection`）这条线**：全程是**推**，协议上没有「拉」的请求方法。

- **触发在扩展手里**。公开面只有 `languages.createDiagnosticCollection()`（`vscode.d.ts:14822`）——扩展自己决定何时算、何时写：php 扩展在 `onDidOpenTextDocument`（`php-language-features/src/features/validationProvider.ts:110`）与 `onDidChangeTextDocument` / `onDidSaveTextDocument`（`:163-166`，按 `php.validate.run` 二选一）之后跑 lint，再 `set()`（`:250`）；git 扩展监听自己 scheme 的文档变化（`git/src/diagnostics.ts:26`）。VS Code 不排期、也没有「诊断 provider」这种注册（`vscode.d.ts` 里没有）。
- **推**：`set()` 里同步调 `MainThreadDiagnostics.$changeMany(owner, entries)`（`api/common/extHostDiagnostics.ts:170`；`delete` ⇒ `:177`，`clear` / `dispose` ⇒ `$clear` `:184`/`:49`）；主线程落到 `IMarkerService.changeOne/changeAll`（`api/browser/mainThreadDiagnostics.ts:87`/`:93`），并给每条 marker 盖 `origin = extHostId`（`:82-84`）。**上限在扩展宿主侧就先砍**：1000/文件、1100 总，另加一条「还有 N 条」的 Info marker（`extHostDiagnostics.ts:134-156`）。
- **回推**：`IMarkerService.onMarkerChanged` → `$acceptMarkersChange`（`mainThreadDiagnostics.ts:32`、`:57-66`），且**按 `origin` 把「这个扩展宿主自己推的」滤掉**（`:61`）⇒ 扩展宿主里的镜像装的是**别人的** marker。`languages.getDiagnostics()` 读的是**本地**（自己的 collections + 这份镜像，`extHostDiagnostics.ts:313-345`），不是 RPC。
- **「拉」只有两处，都是读本地**：扩展宿主的 `languages.getDiagnostics()`（读上面那份本地 map）；渲染器的 `IMarkerService.read()`（接口 `platform/markers/common/markers.ts`；Problems 视图就是 `contrib/markers/browser/markersView.ts:549` 这么读）。两侧协议都**没有请求方法**——`MainThreadDiagnosticsShape` 只有 `$changeMany`/`$clear`，`ExtHostDiagnosticsShape` 只有 `$acceptMarkersChange`（`extHost.protocol.ts:254-257`、`:2382-2384`）。
- marker 带 `modelVersionId`（写的时候扩展宿主按当前文档版本盖，`extHostDiagnostics.ts:140`/`:158`；`markerService.ts:234` 原样保留）⇒ 消费方能判断「这条是对哪个版本算的」。
- **扩展宿主一死，它推的 marker 就消失**：`MainThreadDiagnostics.dispose()` 把每个 owner 里 `origin === extHostId` 的剔掉、重写剩下的（`mainThreadDiagnostics.ts:36-55`）。
- 未核实：LSP 那层自己的 pull（`textDocument/diagnostic`）不在本文范围（`vscode-languageclient` 不在这个 checkout 里，没读）。
