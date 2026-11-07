---
status: in-progress
---

# Technical runtime — extension host, LSP, MCP, webview, extension policy

> 技术设计 L3；根见 [tech-architecture](./2026-11-05-tech-architecture.md)；本文自包含；行为见 [product design](./2026-11-05-product-design.md)。
> 本文给 agent 侧 VS Code runtime 的进程、契约、协议、状态机、并发、错误、测试。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：

- extension host：连接、握手、RPC、主线程、文档 / 配置、扩展扫描、动态激活；
- LSP provider：`ctx.lsp` 四操作、文档同步、查询、超时 / 取消；
- MCP：定义来源、client、server；
- extension policy：两层配置、有效集、桥进宿主；
- webview：secure context、端点、origin；
- 状态 / 并发 / 错误 / 存储 / 测试。

**不在本 note**：IDE 能力 → [tech-ide](./2026-11-05-tech-ide.md)；extension 契约 → [tech-extension](./2026-11-05-tech-extension.md)；UI → [product experience](./2026-11-05-product-experience.md)。

> **约定**：“不在本 note”表示由其他 note / 系统拥有，不等于 prac 不做；真正的 non-goal 见 [product design](./2026-11-05-product-design.md) §7。

## 2. 进程 / 生命周期

```text
DSH server
  ├─ prac-host-vscode（原语：language feature / policy / webview endpoint）
  │    ├─ code server（VS Code server / assets）
  │    └─ extension host（Node IPC；per workspace）
  │         └─ language server（由 extension 的 LanguageClient 启动 / 连接）
  ├─ prac-host-vscode-lsp（provider adapter；same process）
  └─ MCP servers（DSH MCP client）
```

- **extension host 与 page extension host 分开**；per workspace；页面关着也运行。
- **与 code server 的关系**：数据上复用 code server 的 extensions dir / storage；进程上不是 code server 的子进程，由 `prac-host-vscode` fork。
- **LSP 适配是独立插件** `prac-host-vscode-lsp`：它和 `prac-host-vscode` 同属 DSH server 的 plugin row，不另起进程；用基础原语拿 extension host / language feature。
- **language servers**：由扩展通过 `LanguageClient` 启动 / 连接（Node IPC / stdio / socket）；LSP 在 language client ↔ server 之间；不是 extension host 直接与 server 通信。
- **MCP servers** 由 DSH client 起；定义来源是扩展 / 工作区。
- **webview** 在 browser iframe；secure context；endpoint 由部署提供。

### 2.1 Host 状态机

```text
(idle) --start--> (starting) --Ready--> (handshaking)
   ^                  |                     |
   |                  +--error-------------> (error)
   |                                        |
   +------------------stop------------------+
                                           |
                                      (ready) --crash--> (error/restart)
```

- `starting`：spawn / connect IPC；超时 → `HANDSHAKE_TIMEOUT`。
- `handshaking`：Ready → initData → Initialized；失败 → `INIT_FAILED`。
- `ready`：可查询；动态扩展 / 配置变更。
- `error`：可重启；重启不重建 page。

## 3. Extension host 契约

```ts
interface ExtensionHost {
  start(opts: { workspaceRoot: string; policy: ExtensionPolicy }): Promise<void>;
  stop(): Promise<void>;
  status(): "idle" | "starting" | "handshaking" | "ready" | "error";
  subscribe(listener: () => void): () => void;
}

interface ExtensionHostInitData {
  version: string;
  quality: string;
  parentPid: number;          // 0 disables watchdog
  environment: { appLanguage: string; appHost: string; /* … */ };
  extensions: {
    allExtensions: readonly ExtensionDescriptor[];
    activationEvents: readonly string[];
    myExtensions: readonly string[];
  };
  telemetryInfo: Record<string, unknown>;
  logLevel: number;
  loggers: readonly unknown[];
  logsLocation: string;
  remote: unknown;
  consoleForward: boolean;
  uiKind: number;
  autoStart: boolean;
}
```

- 入口：`bootstrap-fork.js` + `VSCODE_ESM_ENTRYPOINT=vs/workbench/api/node/extensionHostProcess`。
- 载体：IPC 管道；`NodeSocket` + `PersistentProtocol`；RPC 帧 `UInt8 type + UInt32BE req + payload`；ProxyIdentifier 线上只发 `nid`。
- 握手：Ready（0x02）→ 一帧 UTF-8 JSON initData → Initialized（0x01）。
- 主线程：`RPCProtocol` + id 表；未实现 actor 走兜底；必须推 `$initializeWorkspace` / `$initializeConfiguration`。
- 文档：`$acceptDocumentsAndEditorsDelta` / `$acceptModelChanged`。
- 扩展：真实扫描 + `fs.watch`；`$deltaExtensions` 动态接住。
- **超时**：握手 / init / query 各自有界；失败清理 socket / child。


### 3.1 连接事实

- 入口：`bootstrap-fork.js` + `VSCODE_ESM_ENTRYPOINT=vs/workbench/api/node/extensionHostProcess`。
- 载体：IPC 管道（`VSCODE_EXTHOST_IPC_HOOK=<socket>`）；纯 node，不依赖 Electron。
- 帧：`NodeSocket` + `PersistentProtocol`；RPC 帧 `UInt8 type + UInt32BE req + payload`；ProxyIdentifier 线上只发 `nid`。
- 握手顺序固定：extension host → Ready（0x02）→ 一帧 UTF-8 JSON initData → Initialized（0x01）；initData 前发 RPC 会让 extension host `JSON.parse` 崩。
- initData 必带：version / quality / parentPid（0 关看门狗）/ environment / extensions / telemetryInfo / logLevel / loggers / logsLocation / remote / consoleForward / uiKind / autoStart。
- 主线程：`RPCProtocol` + id 表从 `out-build` import；不 import 主线程类；不调 `assertRegistered`；未实现 actor 走兜底（返回 undefined 并记账）。
- 超时：握手 / init / query 各自有界；失败清理 socket / child。

### 3.2 主线程事实

- 必须主动推 `$initializeWorkspace`（开 barrier，不推死锁）和 `$initializeConfiguration`（不推 `vscode` 模块注入不出来）。
- 文档：`$acceptDocumentsAndEditorsDelta` 的 lines 是全文；之后 `$acceptModelChanged`（增量 + versionId + eol）；查询时文档不在镜像 → hover reject。
- 配置：`workspace.getConfiguration()` 全从 `$initializeConfiguration` 的 data 读；扩展默认值从 `package.json` 的 `contributes.configuration` 展开。
- 必需 actor：`MainThreadExtensionService` / `Errors` / `Storage` / `Telemetry` / `LanguageFeatures`；按扩展再补 Commands / Diagnostics / Workspace / Configuration / Documents / FileSystem / MessageService / Window / OutputService / Languages。
- `MainThreadLocalization`：`appLanguage !== 'en'` 时必需；`appLanguage:'en'` 最省。
- `MainThreadOutputService`：语言客户端 start 期必需（`createOutputChannel(name,{log:true})` 要完整 LogOutputChannel）。
- 语言服务器：扩展通过 `LanguageClient` 启动 / 连接；css 用 `{module, transport: TransportKind.ipc}`，要 `--node-ipc`；`cwd` 来自 `workspaceFolders[0]`。
- `vscode.version` 必须满足 `^1.91.0`；构造期 `checkVersion()` 不满足会抛。

### 3.3 扫描 / 动态

- 清单来自真实扫描：VS Code 内建目录 + 用户扩展目录；构造 initData 快照。
- 一个工作区一个宿主、多工作区并存；一个工作区查询不影响另一个。
- 扩展目录 `fs.watch` 事件驱动（查询路径不扫描；去抖 500ms；timer unref），另留 `reload()`。
- 运行中扩展走 `$deltaExtensions` 给在跑的宿主；不重启；已起语言服务器不丢。
- 激活：`onLanguage:<lang>` + `onLanguage`；候选激活完 provider 仍缺席 → 立刻 `LSP_UNSUPPORTED_OPERATION`。
- 内建：css / json / html / markdown 需构建；TypeScript / tsserver 已构建；references-view / npm / emmet 不可加载。

### 3.4 存储

- extension host storage 在 XDG state：`globalStorage` 纯 node 文件写；`workspaceStorage` 工作区级。
- workspace memento 当前不可用：`workspaceStorage/<hash>/` 只有 `vscode.lock`、没有 `meta.json`；`workspaceState` 静默失效。
- carrier 在 socket close / parent 退出时终止；`parentPid` 看门狗第二道；`child.kill()` 只是快一点。

## 4. LSP provider

```ts
type LspOperation = "definition" | "references" | "implementation" | "hover";

interface LspQuery {
  operation: LspOperation;
  filePath: string;
  position: { line: number; character: number };
  workspaceRoot: string;
  languageId?: string;
}

type LspResult =
  | { kind: "locations"; locations: readonly LspLocation[]; resolvedWorkspaceUri?: string }
  | { kind: "hover"; hover: LspHover | null };

interface LspProvider {
  readonly id: string;
  readonly extensionToLanguage: Readonly<Record<string, string>>;
  query(query: LspQuery, signal?: AbortSignal): Promise<LspResult>;
}
```

- **0-based UTF-16**；空结果不是错误；不支持 → `LSP_UNSUPPORTED_OPERATION`。
- **没有 capabilities 字段**；不扩 seam。
- 文档：查询前 `$acceptDocumentsAndEditorsDelta` / `$acceptModelChanged` 镜像；不在镜像 → reject。
- 配置：`$initializeConfiguration` 的 `data`；扩展默认值从 `package.json` 展开。
- 服务器：扩展自带；prac 不手配；扩展通过 `LanguageClient` 起 / 连 server。
- **适配位置**：DSH 侧 provider 在独立插件 `prac-host-vscode-lsp` 注册；`prac-host-vscode` 提供基础原语；`prac-vscode-embed` 只做 fork / handshake / RPC / main thread，不认识 `ctx.lsp`。
- **超时 / 取消**：query 有界；AbortSignal；server crash → error。
- **状态机**：unregistered → registered → querying → idle；server crash → error / restart。


### 4.1 调用栈（契约，不是进程）

```text
DSH agent / tools
  → ctx.lsp（DSH seam / 接口）
    → prac-host-vscode-lsp（provider adapter）
      → ctx.pracVscodeHost（server 原语）
        → prac-vscode-embed（fork / handshake / RPC / main thread）
          → extension host（per workspace）
            → language servers
```

- `prac-host-vscode` / `prac-host-vscode-lsp` 是 DSH server 的 plugin row；code server / extension host 是子进程。
- `prac-vscode-embed` 不认识 `ctx.lsp`；适配只在 `prac-host-vscode-lsp`。

### 4.2 当前事实

- 第一条链跑通：VS Code 内建 css 扩展激活；`vscode-languageclient` 起它自己的 server；hover / definition / references 真结果；implementation 由扩展声明不支持。
- 没有手配 `dsh-lsp-stdio` servers；查询由扩展语言服务回答。
- profile 里插了 `@deepseek-ai/dsh-lsp` 与 `@deepseek-ai/dsh-tool-lsp`（bundle 不带）。
- 同一文档二次查询曾把宿主带走（`document already exists`），已用文档镜像 + `$acceptModelChanged` 整档替换修复。
- 限制：只四操作；不做符号 / code action / diagnostics；json / html / markdown / cSpell 搁置；P1 验收标准未定。

## 5. MCP

```ts
interface McpDefinition {
  id: string;
  source: "extension" | "workspace";
  command?: string;
  args?: readonly string[];
  url?: string;
  env?: Readonly<Record<string, string>>;
}

interface McpClient {
  start(def: McpDefinition): Promise<void>;
  stop(id: string): Promise<void>;
  list(): readonly McpDefinition[];
  subscribe(listener: () => void): () => void;
}
```

- **定义来源**：扩展声明 + 工作区配置；不复用 VS Code `contrib/mcp`。
- **DSH 自己起 client**；server 任意来源。
- **当前**：设计已写；实现搁置；不在当前验收。
- **secret**：不放进 UI store；由 runtime / 宿主管。
- **状态机**：defined → starting → running → stopped / error。

## 6. Extension policy

```ts
interface ExtensionPolicy {
  disabled: readonly string[];   // publisher.name
  enabled: readonly string[];    // workspace override
}

interface ExtensionPolicyLoader {
  load(workspaceRoot: string): ExtensionPolicy;
  effective(policy: ExtensionPolicy): readonly string[]; // enabled extension ids
}
```

- 全局：`$XDG_CONFIG_HOME/prac/settings.json`；工作区：`<workspace>/.agent/prac/settings.json`。
- 键：`extensionsIdentifiers/disabled` / `enabled`；JSONC；裸 id。
- 优先级：工作区 enabled → 工作区 disabled → 全局 disabled → 否则启用。
- **桥进宿主**：`userRemote` / `workspace` 两层；宿主 `workspace.getConfiguration` 可读。
- **读一次**：宿主启动时读；改完重启宿主生效。
- **状态机**：absent → loaded → effective → host started；无效 JSON → `POLICY_INVALID`。


### 6.1 优先级 / 桥接

- 全局：`$XDG_CONFIG_HOME/prac/settings.json`；工作区：`<workspace>/.agent/prac/settings.json`。
- 键：`extensionsIdentifiers/disabled` / `enabled`；JSONC；裸 id（publisher.name）。
- 优先级：工作区 enabled → 工作区 disabled → 全局 disabled → 否则启用。
- 桥进宿主：`userRemote` / `workspace` 两层；宿主 `workspace.getConfiguration` 可读。
- 读一次：宿主启动时读；改完重启宿主生效。
- 两个消费者：UI 走 web，自己的启停归 VS Code；agent 是服务端消费者；接受“UI 禁用但 agent 仍加载”的不一致。
- 内建：不是所有都编译出来；哪些视图进 prac 未定。

## 7. Webview

- **secure context**：HTTPS / localhost；`crypto.subtle` / service worker。
- **origin**：宿主页 hostname ≈ `base32(sha256({parentOrigin, salt: webviewOrigin}))`；端点模板 `https://{{uuid}}.<domain>/...`。
- **部署**：通配 DNS + 受信任证书；prac 只把模板交给页面。
- **状态机**：endpoint absent → configured → loaded；origin mismatch → `WEBVIEW_ORIGIN_MISMATCH`。
- **CSP / 资源**：VS Code 的 webview 代码管；prac 不绕过。


### 7.1 本机 / 生产

- webview 需要 secure context（`crypto.subtle` / service worker）和 hostname ≈ `parentOriginHash`。
- prac 选 HTTPS + 通配名；不做 plain HTTP 假支持。
- 部署侧要通配 DNS + 受信任通配证书；本地已端到端验证（自签通配证书 + 本地 TLS 前端 + service worker）；生产部署 open。
- integrated browser 是 Electron-only；web workbench 不可用，不假装存在。
- 内建扩展不可加载时，视图自然没有数据；不把“没编译”当 webview 问题。

## 8. 存储 / 并发

- extension host storage 在 XDG **state**；`globalStorage` / `workspaceStorage`；workspace memento 当前不可用（缺 `meta.json`）。
- 多 workspace = 多 host；策略按 workspace。
- **并发**：host start / stop 串行；LSP query 可并发但有界；MCP start / stop 串行；webview 独立。
- **动态扩展**：`$deltaExtensions` 不重启 host；已起 server 不丢。
- **page reload**：不影响 host；client 重新订阅。

## 9. 错误

| 错误 | 触发 | 处理 |
|---|---|---|
| `HANDSHAKE_TIMEOUT` | Ready / init 超时 | 清理 socket / child；可重启 |
| `INIT_FAILED` | initData 缺失 / 非法 | 同上 |
| `ACTOR_MISSING` | 主线程 actor 未实现 | 兜底 actor；记日志 |
| `HOST_CRASHED` | child 退出 | 状态 error；可重启 |
| `LSP_UNSUPPORTED_OPERATION` | 扩展不支持 | 立即 reject |
| `LSP_CONFLICT` | provider id / 扩展名冲突 | reject |
| `LSP_TIMEOUT` | query 超时 | reject；可重试 |
| `MCP_DEFINITION_INVALID` | 定义非法 | reject |
| `MCP_START_FAILED` | server 起不来 | error；不影响其他 |
| `POLICY_INVALID` | JSON / 键非法 | 回退默认；记日志 |
| `WEBVIEW_ORIGIN_MISMATCH` | hostname / hash 不匹配 | 拒绝加载 |

## 10. 测试

- **unit**：policy effective、initData 形状、LSP 映射、MCP 定义校验、query 超时。
- **L2**：host 握手 / Ready / init / Initialized；provider query；server crash。
- **live**：dynamic / lifecycle；LSP query（headless / 专项）；webview secure；policy live（planned）。
- **planned**：lsp:query / webview:secure / extension-policy:live。

## 11. Open

1. **host supervisor**：重启策略 / 端口 / child 清理。
2. **workspace memento**：补 `meta.json` / `workspace.fs`。
3. **autoSave 门**：真实 rig 验证。
4. **policy 自动化**：手工维护边界。
5. **webview 生产部署**：证书 / 反代。
6. **built-ins**：json / html / markdown / 视图范围。
7. **Copilot 激活**。
8. **LSP acceptance**：James 标准。
9. **MCP 实现**：何时做。

## Related

- [tech architecture](./2026-11-05-tech-architecture.md)：进程 / 模块 / 协议根。
- [tech-extension](./2026-11-05-tech-extension.md)：extension 契约 / catalog。
- [tech-ide](./2026-11-05-tech-ide.md)：client adaptor。
- [tech-quality](./2026-11-05-tech-quality.md)：安全 / 日志 / 部署。
