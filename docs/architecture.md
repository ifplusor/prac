# Prac 的架构

> **现在时。** prac 站在两个成熟系统上：**DSH**（agent harness：一切皆插件的扩展模型）与 **VS Code**（编辑器的能力与生态）。prac 自己只做一件事：**把两者的能力拆散后重新组合成一种界面**。
>
> 每一条结构都标了它的**依据**（`路径:行` 或文件）。理念见 [philosophy.md](philosophy.md)；每个「为什么 + 放弃了什么」见 [.agents/notes/](../.agents/notes/)。
>
> 引用上游时：**DSH** 指 `../deepseek-harness/`（本仓运行的那份安装）；**Code - OSS** 指 `.build/workbench/upstream/`（pin 在 1.137.0 的 checkout，由 `pnpm --filter prac-vscode vscode:build` 取得，不进 git）。

## 0. 一张图

```
浏览器页面（DSH 的 web shell；`dsh web` 注入 window.__DSH_BOOT__）
│
├─ DSH 客户端平面：loader（模块表 = 平台词）→ 每个 bundle 行一个客户端产物（client.js）
│  ├─ prac 自己的 bundle 行
│  │    ui-layout      frame 机制：区域树 / sash / 折叠 / 目录 / 持久化
│  │    vscode-host    一次启动 VS Code + view↔part 策略 + 能力面
│  │    两个座位       vscode:editor / vscode:sidebar（各是一个 prac.view）
│  │    web-app        编排：默认视图、默认落位、角色绑定、注意力、快捷键
│  └─ 页内嵌的 VS Code workbench（每页一个，唯一）
│       create() → EmbeddedWorkbench implements IWorkbenchLayoutService
│       part 挂进 prac 给的容器元素（不是反过来）
│       编辑器：每个文件一个编辑面（view），不是 editor group
│
│  ← 同源 HTTP（静态服务 + 代理）／ WebSocket（管理 / 扩展宿主 / 隧道）
│
DSH host 进程（Node）
│  · prac-host-vscode：/prac-vscode 静态路由 + code server 的 HTTP/WS 代理
│  · DSH 自己的 host 插件（工具 / 上下文 / 会话 / 资源）
│
│  ← fork + 管道 / socket
│
code server 进程（我们的 `out-server` 构建）
   · 扩展宿主进程（唯一能跑扩展 API 的地方）
   · PTY host 进程
```

**三条不变量**（改任何一条都是架构变更，需要裁决）：

1. **不 fork DSH**：替换它的行为走它自己的组装层（bundle / profile / `cordis.patch.yml`）。
2. **不 fork VS Code 源码树**：只 pin + patch + overlay（§3.7），源码不进本仓。
3. **不引第三方改造**（`monaco-vscode-api` / Theia 之类）：直接对官方 Code - OSS 下手，改动要小到可审计。

## 1. 全景：谁拥有什么

| 层                                                                | 拥有者                              | 形态                                           | 依据     |
| ----------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------- | -------- |
| agent harness（模型、工具、会话、持久化、审批）                   | DSH                                 | 插件 + profile/bundle 组装，可 patch 不可 fork | §2       |
| 页面外壳、slot 系统、服务注册表、loader                           | DSH                                 | 客户端平面                                     | §2.3–2.4 |
| 编辑器与 IDE 能力（文本编辑、扩展生态、诊断、终端、语言特性）     | VS Code（Code - OSS 1.137.0）       | 我们构建的 web bundle + server distro          | §3       |
| **frame**（区域树、sash、折叠、视图目录、持久化）                 | **prac**                            | `prac-client-ui-layout`                        | §4.1     |
| **编排**（默认视图、默认落位、注意力、快捷键）                    | **prac**                            | `prac-web-app`                                 | §4.1     |
| **组合**（何时启动 VS Code、哪个 view 用哪个 part、能力怎么暴露） | **prac**                            | `prac-client-vscode-host`                      | §4.4     |
| **服务策略**（路由、端口、构建位置）                              | **prac**                            | `prac-host-vscode`                             | §4.2     |
| 嵌入机制（静态服务、HTTP/WS 代理、每页一次启动、part 宿主元素）   | prac 拥有、但**不知道 prac 与 DSH** | `vendor/vscode-embed`                          | §4.1     |
| 上游 pin / patch / overlay / 构建配方                             | prac 拥有                           | `vendor/vscode`                                | §3.7     |

prac 的核心主张是**所有权与依赖方向**：VS Code 的 **UI 层被拆散、渲染进 prac 的 frame**（而不是 prac 变成 VS Code 的一个 panel）；VS Code 的**能力层**（编辑器、诊断、终端、扩展宿主）经**面**（face）暴露，最终也要暴露给 **agent**。

## 1.5 两端视角：client / server 各有什么

整体是 **BS**（浏览器 + Node 服务端）：客户端零安装，服务端持有 agent、会话与工作区。真正要看的是 **2×2**，而不是一条线——两个系统各自又都跨在线上：

|                 | **client（浏览器里的那一页）**                                                                     | **server（Node 进程）**                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **DSH**         | web shell（loader / 模块表 / `ctx.slots`）+ prac 那几行客户端插件                                  | host 插件（`prac-host-vscode`、DSH 自己的工具/上下文/会话）+ webserver（页面、`/api`、`/prac-vscode`） |
| **VS Code**     | renderer（web bundle）：editor widget、parts/views、`IMarkerService`（**镜像**）、`IEditorService` | code server（**独立进程**）+ 它 fork 的**扩展宿主进程**与 **PTY host 进程**                            |
| **prac 自己的** | frame（ui-layout）、启动与 view↔part 策略、两个座位、编排（web-app）、能力面                       | 路由与代理策略（`/prac-vscode` 静态服务 + code server 的 HTTP/WS 代理）                                |

**两端之间只有三条线**：

| 线                 | 载体                                                                               | 内容                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **DSH 自己的**     | HTTP RPC（`/api`）+ WS（`/api/remote.mux`）+ 启动 token 鉴权                       | 页面上屏与 `client.js` 产物、typert remote（客户端调 host 声明的方法）、转发事件（host→client）、stream / `$events/result` |
| **prac 的**        | `/prac-vscode`（DSH 服务 VS Code 的构建产物）+ code server 的 HTTP/WS 代理         | 让 VS Code 的两个半边在页面看来**同源可达**                                                                                |
| **VS Code 自己的** | WS（Management / ExtensionHost / Tunnel）+ HTTP（静态、`vscode-remote-resource`…） | 渲染器 ↔ code server / 扩展宿主（§3.6）                                                                                    |

**状态住在哪一端**（这张表决定"谁能让 agent 看见什么"）：

| 状态                              | 住在                                                                   | 依据    |
| --------------------------------- | ---------------------------------------------------------------------- | ------- |
| 工作区注册表 / 会话 / session log | **server**（DSH host）                                                 | §2.6    |
| 工具与 agent loop                 | **server**（DSH host）                                                 | §2.6    |
| 扩展与其激活状态                  | **server**（扩展宿主进程）                                             | §3.5    |
| 终端（PTY、scrollback）           | **server**（PTY host 进程；跨断线保活）                                | 决定 19 |
| 诊断 marker                       | **源在 server 的扩展宿主进程**，**镜像在 client**                      | §3.5    |
| 编辑器缓冲区与模型                | **client**（renderer 的 `IModelService`；扩展宿主另有 API 那一份镜像） | §3.4    |
| 打开的文件集合                    | **client**（`IEditorService`）——座位把它投影成 view                    | §4.3    |
| VS Code 自己的 UI 状态            | **client**（IndexedDB，按 `workspace.id`）                             | §4.6    |
| prac 的 frame 布局                | **client**（localStorage，per-origin）                                 | §4.6    |

**这个视角给出的两条原则**：

1. **agent 住在 server，而编辑器的真相大多住在 client** ⇒ 任何"要给 agent 的编辑器能力"都必须在 server 侧找到真相；否则拿到的只能是一个**被页面把关的、有损的**视图（页面得活着，还得把话带到）。这一条把三件看起来无关的事统一了：diagnostics 的选路（§4.4）、`documents` 能力的缺失（§5）、以及"扩展宿主是唯一能调 `vscode.*` 的地方"（§3.5）。
2. **页面是唯一的组装点**：两个 app 都是**每页单例**（`create()` 每页一次、loader 的模块表、store）⇒ **多窗口 = 多页面**；服务端要共享的东西必须挂在 **per-connection** 上（扩展宿主按 `reconnectionToken`，§4.6），不能挂在页面上。

**"以 DSH 为主干"到什么程度**：在**组装与事实**上成立（页面外壳、组合、工作区/会话真相、agent 都在它这边）；在**运行时所有权**上还差一步——`prac-host-vscode/src/index.ts` 里 `CODE_SERVER = { host: "127.0.0.1", port: 3091 }` 是**写死的**，而且**没有任何地方启动它**：主干目前只是"代理一个别人起的进程"。谁起、谁重启、谁关，是记在案的缺口（§5）。

## 2. DSH 的架构（prac 依赖的那部分）

> 本节只写 prac 实际踩到的结构；完整论述见 DSH 自己的 `docs/architecture.md`。

### 2.1 一切皆插件

模型适配、工具注册、session 日志、agent-loop **都是插件**，没有需要 patch 的特权核心；扩展 = 在别的插件旁边挂载一个插件。插件框架是 Cordis（source-vendored，见 DSH `vendor/README.md`）。

- **插件形态**：`Plugin = Function | Constructor | Object`，基类携带 `name?` / `Config?` / `inject?` / `provide?` / `intercept?`（DSH `vendor/cordis/src/registry.ts:87-110`）。
- **`inject` 是依赖声明**，数组形式归一化为 name→config；插件**只在声明的服务全部可用时加载**（`registry.ts:19,71-86,104`）。这就是 prac 的座位能"等 `pracVscode` 出现"的机制。
- **`ctx.provide(name, value)`** 走 fiber 的 effect 注册，返回 disposer（`vendor/cordis/src/reflect.ts:44-46,277-304`）；**`ctx.effect`** 的 body 可返回 disposer（或它们的 promise / iterable），fiber 卸载时**逆序**执行且会 await 它们（`vendor/cordis/src/fiber.ts:69-93,415-418`）——"注册即可逆"是这套框架的基本单位。
- **包的归属**：每个包恰好属于一个 group（`packages/README.md:27-80`）：`core/`（sessions / tools / agent loop 等产品 API 主干）、`api/`（Remote BFF + Typert gateway）、`typert/`、`host/`、`client/`、`bundle/`，以及 `fs/` `context/` `llm/` `session/` `workspace/` `interaction/` 等能力族。**没有 `kernel/` group**；"共享核心"是 `core/` group 与 `@deepseek-ai/dsh-base` 这个 bundle。

**对 prac 的意义**：prac 的每一行都是普通插件，prac 的"深度定制"表现为**组装**，不表现为"改内核"。

**DSH 没有"扩展宿主"**——这个 VS Code 的词不能借过来用，两边的模型正好相反：

- VS Code 的扩展跑在**独立进程**里，只能经 extHost 协议与渲染器说话（§3.5）：**有进程边界，有专用协议**。
- DSH 的插件跑在**同一棵树、同一地址空间**里——host 插件在 DSH 的 Node 进程，client 插件在页面，耦合方式是 **in-process 的 `inject`**：**没有进程边界，也没有专用协议**。

DSH 最接近"第三方代码在运行时进来"的是**动态包（dynamic Cordis packages）**子系统（`packages/extensions/`）：模型能用工具**定义 / 运行 / 停止 / 删除**一个 Cordis 包（`tool-cordis` 的七个工具、`ui-cordis` 的面板），host 半边与浏览器半边各由自己的 runner 求值。它的隔离是**沙箱，不是容器**：

- host 半边在 `node:vm` 的**全新 realm** 里求值，外面套一层白名单 façade（框架内部、以及"返回值是 Context"的服务被拒；参数 schema 与值被重建为宿主对象），文件 / 网络 / 进程 / 定时器被 trap 导向 `ctx.fs` / `ctx.web` / `ctx.bash` / Cordis timers（`cordis-host-runner/src/sandbox.ts`、`guard.ts`）；
- 模块注释自己写明：_"keeps cooperative packages inspectable and disposable but **is not containment**: host-realm helper functions remain an escape route"_；
- 浏览器半边在页面的闭包里 `new Function` 求值（`cordis-client-runner/src/client/evaluator.ts:180`）；
- 定义**只活在进程内存**里，重启即失。

**对 prac 的两点意义**：① 给 agent 的 **DSH 侧能力**是"挂进同一棵树"（`ctx.tools.register`），而 **VS Code 侧能力天然要有一个"宿主里的适配器"**（只有扩展宿主能调 `vscode.*`）——这正是 §4.4 里 diagnostics 的选路依据；② "让浏览器跑一个插件半边"这件事，DSH 是靠 §2.5 那两个 `cordis/request-run*` **转发事件**做的，**不是** RPC。

### 2.2 组装：profile → bundle → patch

patch 层按固定顺序叠在空 entry list 上（DSH `apps/cli/src/profile-boot.ts:2-6`；语义实现在 vendored include 的 `applyEntryPatches`，`vendor/include/src/index.ts:58-118`）：

```
每个 bundle 的 patch（按 dsh.profile.bundles 的顺序）
  → profile 自己的 cordis.patch.yml
    → home 级 patch
      → --patch <path>（可重复，按 argv 顺序）
```

| 层          | 是什么                                                                                                                               | 位置（prac 的实例）                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| **profile** | 命名组合：它叠哪些 bundle（`dsh.profile.bundles`）、`patchReload`（`live` / `startup`）、持有哪些 out-of-tree 插件、自己那一层 patch | `~/.dsh/profiles/prac-dev/package.json`                        |
| **bundle**  | Cordis 配置行 + 它们挂载的代码的分发格式；`package.json#dsh.bundle.patch` 指向它的 patch 文件                                        | `packages/bundle/web-app/cordis.patch.yml`                     |
| **patch**   | 按 **id** 定位一行并**整体替换**它的 config（不是合并），或 `insert` 新行、`disabled: true` 摘掉一行                                 | 同上；profile 层是 `~/.dsh/profiles/prac-dev/cordis.patch.yml` |

两条实测语义：**patch 匹配不到就 warn 并跳过**（不报错）；**同一 patch 列表里更晚的条目能定位到更早 `insert` 进去的行**（插入后立即建索引）。`dsh --profile <name> --dump-config` 能打印组装后的整棵树而**不 boot**——这是 prac 调试组合时的第一条命令。

prac 的 profile 列出了三个 bundle，按序叠加：`@deepseek-ai/dsh-base`（共享第一层：模型、工具、持久化、沙箱与审批、设置、凭据）→ `@deepseek-ai/dsh-web-app`（浏览器应用）→ `prac-web-app`（prac 自己的组合）。**顺序是承重的**：prac 的 patch 里 `- id: ui-layout / disabled: true` 之所以能定位到 DSH 自带的那一行，正因为它在 dsh-web-app 之后应用（`packages/bundle/web-app/cordis.patch.yml` 的注释）。

**两个 DSH 语义，prac 直接吃**：

- **行的 `id` 与 `name` 是两件事**：`name` 是 entry 实际 import 的**模块 specifier（= npm 包名 / 产物 id）**，`id` 是它在 entry tree 里的**稳定标识**（patch 用它定位；缺省时随机生成，嵌套用 `:` 拼父 id）。所以"加一个视图 = 加一行（`name` 指向包）"、"换掉 frame = patch 掉一行（`id` 定位）"（DSH `vendor/loader/src/config/entry.ts:8-21,75-81`、`tree.ts:8,66-73`）。
- **行的顺序不携带 load 语义**：激活由服务可用性驱动（`packages/bundle/base/cordis.patch.yml:9-10`）。
- **Model-visible ⟺ logged**：任何到达模型请求的东西都必须能从 session log 重建；新的模型可见输入需要新 session event（见 [proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md](../.agents/notes/proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md)）。

### 2.3 双平面：host 与 client

一个包可以有 host 半边与 client 半边（`package.json#dsh.client.platform = "web"`）。两侧的**产物契约完全不同**：

- **host 半边**是普通 Node ESM 模块，由 profile 的模块解析加载（`prac-host-vscode` 连 `@deepseek-ai/cordis` 都不打包，靠 profile 的 module fallback 在运行时解析）。
- **client 半边**必须是一个 **loader 产物**：DSH 逐字服务 `exports["./client"]`，浏览器以同源 classic `<script src>` 执行它，它只做一件事——注册一个工厂：

  ```js
  window.__ModuleLoader__.load({
    id: "<产物 id>",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      /* …bundle… */
      return module.exports;
    },
  });
  ```

  `module` / `exports` 是 bundle 自己合成的局部变量，**传进 factory 的只有 `require`**（DSH `packages/client/tsdown.client.ts:566-568`、`packages/client/modules/src/client/manifest.ts:258-268`）。这就是为什么 prac 的打包器必须产出"loader 产物"而不是"一个 bundle"。

prac 把这个契约的**两半**都固定了下来：

- `scripts/pack-client.ts` = 形状（CJS on browser、banner 开闭包 + CJS envelope、footer 返回 exports、产物固定 `client.js`、只有声明的外部依赖留未解析）；
- `scripts/bundle-client.mjs` = **证明它真的长这样**（闭包完整、每个 `require` 都在加载器模块表里可答、没有内联第二份 React）。

**平台词表**（`scripts/pack-client.ts` 的 `PLATFORM_MODULES`）是 loader 冻结模块表的镜像，单一来源是 DSH 的 `packages/client/web/src/platform.ts`（由 `seed.ts` 播种）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。两条实测规则：**表外的 `require` 必炸**；**表内的东西被内联 = 两个单例**（React 内联是白屏，store 内联是第二份状态引擎）。

### 2.4 页面外壳：slot / view / service

- **slot 系统**：客户端 UI 通过 `ctx.slots` 的**命名槽**扩展（`SlotMap` 是一个空的 merge 点，槽由 owner 用 `declare module` 声明；注册未声明的 key 会抛错）。一次 `register` 同时提交组件、可选的子槽声明与 store seat。
- **shell 只渲染一个洞**：`'root'`（`packages/client/ui-renderer/src/client/registry.ts:29-45`），注释明确 **DO NOT register here**——它是单值槽，第二份注册会遮蔽**整个 frame**。DSH 自带的 frame 占据它，并声明四个座位：`sidebar`(single) / `main`(keyed) / `rightbar`(single) / **`shell.overlay`(list)**；后者是 frame 级浮动层（additive、默认 click-through），是插件注册自有全局 surface 的官方位置。
- **prac 的槽不是 DSH 的槽**：`prac.view` 是 **prac 自己声明**的槽名（DSH 里不存在这个词）；prac 的 frame 从它的注册表**按成员**读（不按 id 前缀——机制不该认识来源词）。
- **服务注册表**：`ctx.provide` 发布、`inject: ["name"]` 消费，**消费方会 pending 直到它出现**。prac 用它跨 bundle 传面（座位不能 import 机制的实例——每个客户端产物各自内联，模块状态不共享）。
- 页面外壳自身是根级 `apps/web` 构建的（包名 `@deepseek-ai/dsh-web-frontend`）；它**不是独立应用**——只有 `dsh web` 注入 `window.__DSH_BOOT__`（boot 图）+ `window.__ModuleLoader__`（module table）才能起来（`apps/web/vite.config.ts:9-12`）。

### 2.5 协议：remote（Host-for-Client）

`ctx.remote` 的形状**几乎全是单向的**：host 声明 `TypertRemoteContribution { package, descriptors }` 并 `$mount(contribution)`，client 挂载这些方法（服务键 `remote.<namespace>`）；`$on` 是 host→client 的**转发事件**；`InvocationDescriptor.invocation.kind` 是 `direct`（receiver = gateway root ctx）或 `context`（从 wire 取身份、解析成 live Context 作 receiver）——`mode: 'stream'` 是正交的第二维，不是第三种 kind（`packages/typert/protocol/src/types.ts:268-324`）。

**没有通用的 host→client request/response**（没有 `$invoke`、client 侧没有 service registry）。**唯一的受限例外**：allowlist 里被选中的 **waterfall** 事件构成"host 发起、await 客户端返回值"的通路（host `forwardWaterfall` await，client listener 派发后调回 `$events/result`；`packages/api/remotes/src/index.ts:134-157`、`gateway/src/client/remote-events.ts:185-221`）。允许转发的 Cordis 事件共 **19 条**，收口在 `API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts:16-36`），其中 `approval/request` 与 `user-questions/request` 是 waterfall，其余是单向 emit。

**对 prac 的意义**：能力面要么在 host 侧自足，要么落成 host→client 的单向投影；"host 主动问页面"只能走 waterfall 白名单那一条窄路（§4.4）。

### 2.6 服务面

| 能力                | 挂点                                                                                                                                                                                                                  | prac 现状                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 工具                | host 侧 `ctx.tools.register(defineTool({ name, description, parameters, output, execute }))`（`packages/core/tools/src/schema.ts:483-547`；执行入口是 `execute`，没有 `handler`）                                     | **未用**（agent 能力面还没有实体）     |
| 会话与投影          | `ctx.sessions`（`SessionStore`，**不是 `ctx.session`**）+ `ctx.sessionProjections.register({ key, stateVersion, stateSchema, init, apply })`（对 session 事件做折叠，必须同步、state 必须是 plain JSON）              | 未用                                   |
| 资源                | `ctx.resources.register(provider)` —— **只在 client 半边存在**（同一个包的 host 半边是空实现）                                                                                                                        | 未用                                   |
| 客户端状态          | `createSnapshotStore<T>(init, { flush, persist })`（`@deepseek-ai/dsh-client-store`）：`flush` 默认 `sync`，`raf` 把一帧内的变更并成一次通知；`persist: { name }` 创建时读一次 localStorage、之后**每次变更整值写回** | **用了**：`ui-layout` 的持久化（§4.6） |
| 工作区 / 会话注册表 | `@deepseek-ai/dsh-api-workspace-controller` / `-session-controller` 的 client 半边（快照 + `list`）                                                                                                                   | **用了**：解析活动工作区（§4.3）       |

### 2.7 prac 对 DSH 的依赖分级

- **稳定约定**（prac 建立在其上）：`package.json#dsh` 的 `bundle` / `client` / `profile` 三个字段；patch 的 `id` / `insert` / `disabled` 语义；`exports["./client"]` 的 loader 产物形状；平台词表；`ctx.provide` / `inject` 的等待语义；`prac.view` 这类命名槽；快照 store 的 `persist`。
- **用到但属于实现细节**（升级时优先复核）：DSH 自带 `ui-layout` 行的 **id 拼写**（prac patch 里按 id 摘掉它）、API controller 包的**导出名**（`IWorkspaces` / `ISessions`）、`ctx.sessions.list.getSnapshot().current` 这类**快照字段形状**。
- **prac 明确不碰**：agent-loop 的轮次结构；DSH 的 i18n / class 集合 / 组织约定（借鉴可以，套用不行）。

## 3. VS Code 的架构（prac 依赖的那部分）

### 3.1 分层

`src/vs/` 的有序层（书面表述在 `.github/instructions/source-code-organization.instructions.md:12-20`）：

```
base → platform → editor → workbench → code → server → sessions
（每层只能 import 下层；code 是桌面入口，server 是远程/服务端入口）
```

两层约束是**机器强制**的：

- **包层**（谁能 import 谁）：`local/code-import-patterns` 的逐层 `target`/`restrictions`（`eslint.config.js:1521` 起；`base` 只能 `vs/base/~`，`platform/*` 加 `vs/platform/*/~`，`workbench` 加 `vs/workbench/services/*/~` 但**不含** `vs/workbench/contrib/*/~`，以此类推）；
- **环境层**（`common` ← `browser` / `node` ← `electron-*`）：`local/code-layering`（`eslint.config.js:110-135`，规则本体 `.eslint-plugin-local/code-layering.ts`）。

一处**规则漂移**（值得知道，别被文档误导）：书面规则说 "workbench 绝不能 import sessions"，而 ESLint 实际放行 `vs/workbench/contrib/*/~ → vs/sessions/~`（`eslint.config.js:1851`）。**以 ESLint 为执行事实。**

**对 prac 的意义**：`workbench` 是可以被替换组合的那一层——上游自己就有 `code`（桌面）与 `sessions`（另一个 app）两个消费者，我们走的是同一条缝。

### 3.2 依赖注入与 contribution

服务用 `createDecorator(id)` 声明标识（`platform/instantiation/common/instantiation.ts:109`）、经 `InstantiationService` 构造注入；`registerSingleton(id, ctor, InstantiationType.Delayed|Eager)` 声明全局单例（`instantiation/common/extensions.ts:25-27`），服务集合按 workbench 组装：`BrowserMain.initServices()` 建集合并把环境服务直接 `set` 进去（`web.main.ts:282-305`），`Workbench.initServices()` 先把自己注册为 `IWorkbenchLayoutService`（`workbench.ts:195`）再灌入全部单例描述符（`:210-216`）。

**contribution 是另一回事**：它是"进入 workbench 生命周期"的模块，由注册表统一实例化（`Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).start(accessor)`，`workbench.ts:162`），声明 API 是 `registerWorkbenchContribution2`（`workbench/common/contributions.ts:13`）——**part 由服务 eager 造**（`IPaneCompositePartService` / `ITitleService` / `IStatusbarService` / `EditorParts`），part 构造时**自注册**进 layout service（`workbench/browser/part.ts:61`），但只有被 `create(parent)` 时才进 DOM——这条是 prac 能"造 part 但不给它位置"的前提（§3.8）。

### 3.3 workbench 组合：part / view container / view

三个粒度，**从粗到细**：

| 粒度               | 是什么                                                                                                                | prac 怎么用                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **part**           | 一整块标准 IDE 区域（sidebar、editor、panel、statusbar…）；单实例，只能**搬**不能重建；自带的 grid 定位靠区分性 class | 座位的一种实现（`vscode:editor` → `workbench.parts.editor`，`vscode:sidebar` → `workbench.parts.sidebar`） |
| **view container** | 一列 view 的分组（可选的高级形态）                                                                                    | 未作为组合单位（决定 2b）                                                                                  |
| **view**           | 最小容纳单位（一个 pane、自己的 header、自己的尺寸）                                                                  | **prac 的组合单位**；`mountViewInto` 接受任意外部 parent（`ViewPaneContainer.create(parent)`）             |

`IWorkbenchLayoutService`（`src/vs/workbench/services/layout/browser/layoutService.ts:473` 起）约 51 个成员——上游全部布局语义的接口（`layout()` / `isRestored()` / `getContainer` / `isVisible` / `setPartHidden` / `getSize` / `resizePart` / `registerPart` …）。经典布局由 `abstract class Layout` 实现，内部持有 `SerializableGrid`（`src/vs/workbench/browser/layout.ts:156,283,1676`）。**prac 不替换它**，而是自己实现一份给嵌入用：`overlay/embeddedWorkbench.ts` 的 `EmbeddedWorkbench implements IWorkbenchLayoutService`，`layout()` 按外部宿主元素的尺寸驱动（§3.7）。

两个有用的上游事实：`renderWorkbench` **硬编码创建八个 part**（TITLEBAR / BANNER / ACTIVITYBAR / SIDEBAR / EDITOR / PANEL / AUXILIARYBAR / STATUSBAR，`workbench.ts:345-366`）；而**"view container" 就是 pane composite**——`IViewsService` 为每个 `ViewContainer` 动态生成一个 `PaneComposite` 子类并注册（`viewsService.ts:640-683`），所以 prac 走 view 这一级时并不需要 container 概念。

### 3.4 编辑器：group 与单编辑面

上游的编辑器是 **editor part → editor group → editor**；prac 用的是**最里面那一层**：

- 编辑控件：`CodeEditorWidget`（`src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts:69`，"一个控件 = 一个 model 的视图"）+ `ITextModelService.createModelReference`（`src/vs/editor/common/services/resolverService.ts:16-23`）。workbench 侧的承载链是 `EditorPane`（`editorPane.ts:49`）→ `AbstractTextCodeEditor`（在 `textCodeEditor.ts:41` `createInstance(CodeEditorWidget, …)`）——prac 直接镜像这一层。
- 打开/关闭/查询：`IEditorService.editors` / `activeEditor` / `getEditors(order)` / `findEditors` / `closeEditors` / `onDidEditorsChange`（`src/vs/workbench/services/editor/common/editorService.ts:159-368`）；`EditorInput.isDirty` / `onDidChangeDirty`；`IEditorGroup.previewEditor`（预览态，`editorGroupsService.ts:748` 起）。
- 文件与模型：`IFileService.hasProvider`（**过滤不可渲染的输入**，例如 `walkThrough:` / `untitled:`）、`canHandleResource`（等远端文件系统 provider 就绪——不等就是 `Unexpected model for TextResourceEditorInput` 这个竞态）、`IModelService`。
- 诊断：`IMarkerService.read({ resource })` / `onMarkerChanged` + `MarkerSeverity`。

**group 与单个编辑控件的区别**（prac 选择后者的原因）：`IEditorGroup` 是**模型/布局层的容器**——一个网格单元里托管多个 `EditorInput`，有 `id` / `index` / `activeEditorPane` / `editors` / `openEditor`；编辑控件只是"渲染一个 `EditorInput` 的 widget"。用 group 就等于接受"一个区域里多个文件 + tab + group 模型"，与 prac 的 frame 冲突。

**决定 17**：prac 里的"编辑器" = **一个文件的编辑面（一个 view）**，不是 editor part / editor group；**tab 条与分栏由 prac 的 `stage` 提供**。理由：用上游的 editor part 会把 tab 与 group 模型一起继承进来，chat 与 editor 就无法在 stage 里自由并排。

### 3.5 扩展系统与扩展宿主

- **宿主有三种**（`src/vs/workbench/services/extensions/common/extensionHostKind.ts:11-14`）：`LocalProcess`（Node，本地/服务端）、`LocalWebWorker`（浏览器 worker）、`Remote`（远端）。我们的服务端形态用的是 `LocalProcess`：code server fork 一个**扩展宿主进程**（入口 `vs/workbench/api/node/extensionHostProcess`），扩展的贡献点在那里被解析，UI 贡献经 **extHost 协议**投影到渲染器。
- **extHost 协议**是这份类型合同：`src/vs/workbench/api/common/extHost.protocol.ts`（4218 行）——`MainContext` 用 `createProxyIdentifier('MainThreadXxx')` 枚举全部主线程代理，`ExtHostContext` 枚举反向代理；运行时是 `RPCProtocol`（`services/extensions/common/rpcProtocol.ts:115`），代理标识在 `proxyIdentifier.ts`，主线程侧以 `@extHostNamedCustomer(MainContext.MainThreadXxx)` 注册（`api/browser/mainThreadCommands.ts:16`）。
- **诊断的流向是"扩展宿主 → 渲染器"**：扩展宿主调 `MainThreadDiagnostics.$changeMany` / `$changeOne`，主线程把它写进**渲染器自己的** `IMarkerService`。所以浏览器里的 marker 是**镜像**，不是原始状态；DSH host 不在这根线上。
- **唯一能调扩展 API 的地方是扩展宿主**（例如 `vscode.languages.getDiagnostics()`）。这条决定了能力面的可选路线（§4.4）。
- **贡献点**由 `ExtensionsRegistry.registerExtensionPoint({ extensionPoint, jsonSchema, deps?, activationEventsGenerator? })` 声明（`services/extensions/common/extensionsRegistry.ts:109,691`）；可用点名列在 `services/extensions/common/extensionPoints.json`。扫描器 `IExtensionsScannerService.scanAllExtensions()`（`platform/extensionManagement/common/extensionsScannerService.ts:140-148`）→ `ExtensionDescriptionRegistry` → `IExtensionService.activateByEvent()`。
- 扩展来源：市场（需要 `product.json` 的 `extensionsGallery`——OSS 产品默认没有，我们由 `overlay/gallery.ts` 单一来源盖给服务端与客户端两份）；扫描结果缓存在 `--extensions-dir` 的 `extensions.json`（**它是缓存**：手工加目录而不删它，扫描器不会发现新扩展）。
- web 扩展宿主是另一回事：跑在页面的 worker/iframe 里（`ExtensionHostKind.LocalWebWorker`），靠 `postMessage` + `MessagePort`，服务端不参与；它能做什么由 `api/worker/extHost.worker.services.ts` 决定（对照 node 的 `api/node/extHost.node.services.ts`），web 打包因此显式排除 `node` / `electron-*` 目录（`build/gulpfile.vscode.web.ts:103`）。

### 3.6 两种形态与它们之间的通道

| 形态              | 产物                                                                                       | 谁在跑                                    |
| ----------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **web bundle**    | `out-vscode-web`（`vs/…` + `nls.messages.js`，~37MB，必须**同源**服务，worker 跨域会被挡） | 浏览器里的渲染器（我们嵌进 DSH 页的那份） |
| **server distro** | `out-server`（扁平产物；`product.json`/`package.json`/`out/` 由 checkout 根提供）          | Node：code server + 扩展宿主 + PTY host   |

渲染器与服务端之间的通道（完整清单与证据见 [in-progress/2026-09-09-vscode-dsh-integration.md](../.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md) §6）：

- **HTTP**：静态资源、`/vscode-remote-resource`、`/callback`、`/web-extension-resource`；鉴权 `?tkn=`。
- **WebSocket**（一个端点、**首消息分型**，每型各开一条自己的连接）：`Management`（服务端注册命名 channel、渲染器消费）、`ExtensionHost`（服务端 fork 扩展宿主并用管道/socket 桥到这条 WS）、`Tunnel`（端口转发）。服务端状态机是 `WaitingForAuth → WaitingForConnectionType → Done`，**commit 不一致会被直接拒绝**（`Client refused: version mismatch`，`remoteExtensionHostAgentServer.ts:291-410`）——把 §3.7 那条盖章规则从"表现"变成"根因"。
- **渲染器怎么知道连哪**：服务端把 `WORKBENCH_WEB_CONFIGURATION` 注入 workbench HTML，内容含 `remoteAuthority` / `serverBasePath` / `developmentOptions` / `productConfiguration`（`webClientServer.ts:396,416-443`）；这些正是 `IWorkbenchConstructionOptions` 的字段（`web.api.ts:149-187`，另有 `connectionToken` / `webSocketFactory` / `resourceUriProvider`）。
- **两个 `product.json` 必须同一 commit**：段值由 `getServerProductSegment(product) = ${quality ?? 'oss'}-${commit ?? 'dev'}` 算出（`base/common/network.ts:262-264`），拼进服务端资源根路径（`:207`）。客户端按构建注入的值要 `/oss-<commit>/…`，服务端运行时自己算；不一致的表现是"编辑器打不开文件"，不是路径报错。
- **server distro 里只有服务端与扩展宿主**：`build/buildfile.ts:54-63` 的 `codeServer` 条目 = `extensionHostProcess` / `watcherMain` / `ptyHostMain` / `agentHostMain` / `diffWorkerMain`——**没有 Electron、没有桌面 workbench**。这就是我们能把它当"纯扩展基座"用的原因。

### 3.7 我们的 vendor 形式与构建

**pin + patch + overlay**（不是 source-vendored）：

- **pin**：`vendor/vscode/package.json#prac.vscode`（tag `1.137.0`，构建解析到 commit `645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`）。
- **patch**：`patches/0001-prac-vscode-composition.patch`（**两个文件、三处**，全是 delta）：
  1. `web.factory.ts` —— `create()` 改用 `EmbeddedBrowserMain`（import + 调用两处 hunk）；
  2. `web.main.ts` —— `configuration` 由 `private` 改 `protected`（覆写 `createWorkbench` 的组合者要把它交给 `EmbeddedWorkbench`：construction options 里有 `workspaceProvider` 这类"部件够不到"的东西）；
  3. `web.main.ts` —— `resolveWorkspace()` 里 `URI.revive()` 序列化的 `UriComponents`（不 revive 过不了 `isSingleFolderWorkspaceIdentifier` 的 `URI.isUri` 守卫，表现为"工作区打开了但是空的"）。
- **overlay**：我们**自己的完整文件**，构建期拷进 checkout（`overlay/bridge.ts` → `src/vs/workbench/browser/embedBridge.ts` 是**两侧编译的同一份**交互契约；`overlay/embeddedWorkbench.ts` 790 行；`overlay/embeddedWebMain.ts` 44 行；`overlay/page.html` 独立查看页）。载荷不进补丁：补丁应当是 delta，放进补丁会让"我们对上游做了什么"淹没在自己的代码里。
- **构建**（`vendor/vscode/scripts/build.mjs`）：clone（pin）→ reset → 应用补丁 → stage overlay → `npm install --ignore-scripts`（跳过 native / playwright / copilot 这些消费环境跑不通的步骤）→ 转译 → 打包**两个目标**：
  - **web bundle**：上游的 `build/next/index.ts bundle --target web …`（`build/gulpfile.vscode.web.ts:35-46,174`），产物 `out-vscode-web`；
  - **server distro**：`--target server`，**必须带 `--nls`**（`--nls` = 抽取 `localize` 字符串改写为按 key 查表，`build/next/index.ts:50,1165`；不开就构建失败）。
  - **盖章**：最后写 `product.json`（commit + `extensionsGallery`，盖 `.` / `out-server` / `out-server-web` 三处）。`product.json` 在上游是**构建期替换进 `product.js` 的占位符**（`/*BUILD->INSERT_PRODUCT_CONFIGURATION*/`，`gulpfile.vscode.web.ts:127-148`），所以运行期 `IProductService` 读的就是它。
- 产物布局、`vscode:build` / `vscode:serve` / `vscode:smoke` / `vscode:verify-*` 的用法见 `vendor/vscode/README.md`（那里也是"我们对上游的改动日志"，要求**穷尽**）。

### 3.8 可被组合者使用的缝

| 缝                                                                                                                    | 用途                                                                                                                                                                                         | prac 的用法                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `create(domElement, options): IDisposable`（`web.factory.ts:28`，**只能调一次**）                                     | 唯一的模块级入口；把 `options.commands` 注册进 `CommandsRegistry`，返回 disposable（释放即 shutdown）                                                                                        | **我们的主线**：`prac-vscode-embed/client` 每页调一次                                            |
| `IWorkbenchConstructionOptions`（经 `IBrowserWorkbenchEnvironmentService.options` 读，`environmentService.ts:29-34`） | 嵌入方交给 workbench 的全部构造事实：`remoteAuthority` / `serverBasePath` / `connectionToken` / `webSocketFactory` / `resourceUriProvider`（`web.api.ts:149-187`），以及我们的 `vscodeEmbed` | bridge 对象从这里进去；workspace 也来自这里（`workspaceProvider`）                               |
| `IBrowserMainWorkbench.createWorkbench`（`protected`，`web.main.ts:271`）                                             | 换一个 app，而服务/DI/扩展宿主引导全部保留                                                                                                                                                   | `EmbeddedBrowserMain` 覆写它返回 `EmbeddedWorkbench`                                             |
| `IWorkbenchLayoutService`（`layoutService.ts:473`）                                                                   | 布局语义的全部接口                                                                                                                                                                           | `EmbeddedWorkbench` 实现它，把 part 挂进**外部**宿主元素、按宿主尺寸 layout                      |
| 模块级 `commands` / `logger` / `env` / `window` / `workspace` 命名空间与 `IWorkbench` 门面（`web.factory.ts:83-99`）  | 命令入口（`create()` 只返回 disposable）                                                                                                                                                     | 打开文件、`openWorkspaceFolder`（页侧构造不出 `URI` 实例，所以由持有 `URI` 的 workbench 侧代调） |

**一次踩坑定型的设计**：editor part **必须存在**（服务图需要它），但**不该上屏**。做法是 `createDetachedPart("workbench.parts.editor")`——造出来、留在屏外、永不挂载；否则 `openEditor` 会在 `isLocked` 上抛错、任何文件都打不开。

## 4. prac 的整合

### 4.1 包与职责

```
packages/
  client/ui-layout            机制：frame（区域树 / sash / 折叠 / 视图目录 / prac.view 槽 / ctx.pracLayout / ctx.layout 兼容 shim / 持久化）
  client/vscode-host          策略：何时启动 VS Code（一旦 DSH 报出工作区）、view↔part 映射、pracVscode 面（含能力面）
  client/ui-vscode-editor     座位：声明 vscode:editor
  client/ui-vscode-explorer   座位：声明 vscode:sidebar
  bundle/web-app              编排：默认视图与落位、角色绑定、注意力条、快捷键（host 半边什么都不做，只为让 client 半边被扫到）
  host/vscode                 服务策略：/prac-vscode 路由、code server 端口、构建位置与开发覆盖
vendor/
  vscode                      pin + patch + overlay + 构建配方（**不是 DSH 插件**：无 main、无 dsh 字段、exports 只有 package.json 与契约）
  vscode-embed                嵌入机制：host 半边（同源静态服务 + code server HTTP/WS 代理）与浏览器半边（每页一次启动 + part 宿主元素工厂）；**不知道 prac 与 DSH**
```

**依赖方向**：`prac-vscode`（契约）← `prac-vscode-embed` ← `prac-host-vscode` / `prac-client-vscode-host` ← 两个座位 / `web-app`。**运行时**的耦合不走 import，只走 DSH 的服务注册表与槽：座位不 import 机制，而是 `inject: ["pracVscode"]` 等它出现。

### 4.2 组合

- **profile `prac-dev`**（`~/.dsh/profiles/prac-dev/`）叠三个 bundle：`dsh-base` → `dsh-web-app` → `prac-web-app`；prac 的包以 `link:` 挂进去。
- **`packages/bundle/web-app/cordis.patch.yml` 就是 prac 的组合**：摘掉 DSH 自带的 `ui-layout` 行（`disabled: true`，包本身留着——别的包要靠它的类型 augment `SlotMap`），插入六行（机制、VS Code 客户端机制、两个座位、VS Code host 策略、编排）。
- **客户端产物**：每行的 client 半边经 `scripts/pack-client.ts` 打成 loader 产物，再由 `scripts/bundle-client.mjs` 断言形状。
- **同源**：`prac-host-vscode` 在 DSH 的 webserver 上注册 `/prac-vscode`（静态服务构建出的 VS Code bundle）与 code server 的代理——WebSocket 不受 CORS 约束可以直连，HTTP 不行所以要代理。于是页面、VS Code bundle、code server 三者同源。

### 4.3 一条页面从零到有像素

1. `dsh web` 起 DSH，注入 `window.__DSH_BOOT__`；loader 按平台词表播种模块表，按行加载客户端产物。
2. `ui-layout` 起 frame：区域树 + sash + 折叠 + 视图目录 + `prac.view` 槽 + 持久化。
3. `prac-client-vscode-host` **等**工作区：从 DSH 的 workspaces / sessions 快照里解析当前会话所属的工作区（**工作区是会话事实，不是构建常量**），没有就不启动——`workspace.id` 在 `create()` 时定死，之后无法纠正。
4. 启动 VS Code：`create()`（每页至多一次，页级记录而非模块状态——因为每个消费者各自内联这个模块）→ 拿到面（part 宿主元素工厂、命令命名空间、打开文件 / 打开工作区）。
5. 把面发布到服务注册表（`ctx.provide("pracVscode", …)`）：座位由此从 pending 变可用。
6. 座位渲染 `prac.view` 的组件：组件交出宿主元素，`movePartInto` 把 part 搬进去；`ui-vscode-editor` 还按 `editors` 能力**为每个打开的文件声明一个 `vscode:file:<resource>` view**，并把 dirty / active 同步成 view flags。
7. `web-app` 的编排把视图放进区域（默认落位**只填空缺**，否则持久化会自我撤销），注意力可以把它在轨道与中央之间搬移。

### 4.4 四条契约

| 契约                                                              | 单一定义在哪                                                                                                     | 为什么必须单一                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **嵌入桥**（`EMBED_BRIDGE`：options 字段名、面的类型、校验器）    | `vendor/vscode/overlay/bridge.ts`（构建期拷成两侧同一份文件；消费方 `import … from "prac-vscode"`）              | 它跨 **patch 侧与 prac 侧**，字段名写两遍就是两处漂移                |
| **`prac.view` 槽**                                                | `packages/client/ui-layout/src/client/contract.ts`                                                               | 座位与机制之间唯一的运行时耦合点；机制按注册表成员判定，不按 id 前缀 |
| **`pracVscode` 服务面**                                           | `packages/client/vscode-host/src/client/public.ts`（类型出口；运行面在 `index.ts`）                              | 座位与机制分属不同 bundle，模块状态不共享                            |
| **能力面**（`capabilities.editors` / `capabilities.diagnostics`） | `prac-vscode-embed/client` 的 `Capability<T, A>`（`snapshot` / `subscribe` / `settled` / `version` / `actions`） | 它与"哪个 view 挂着"无关：不挂 view 也能回答（活体门断言过）         |

**能力面的定位**（[proposed/2026-09-15-vscode-capabilities-into-prac.md](../.agents/notes/proposed/2026-09-15-vscode-capabilities-into-prac.md)）：它是 prac 里 **UI 与 agent 的唯一真相**——UI 用它渲染（tab 脏点、诊断计数），agent 未来用它取事实；判据是**没有 view 挂载也能回答**、**两个消费者读同一份真相**、**不开 `executeCommand` 后门**。已落地 `editors` 与 `diagnostics` 两条；`diagnostics` 目前只有**浏览器侧**这一份实现（读的是渲染器镜像，§3.5），host 侧的路还没有实体。

### 4.5 布局的所有权

- **frame 是 prac 的**（决定 7）：只**借行为**（视图契约、树形摆放、收起记宽、layout policy 的写法），不让上游的 grid 拥有 prac 的 frame。
- **VS Code 提供"一个文件的编辑面"**（决定 17），**tab 与分栏由 `stage` 提供**；`stage` 支持任意方向分栏，且**任何方向都不造空 region**（分栏以 view 为主语）。
- **part 永远是被容纳的一方**（决定 2）：经 host 挂进来、可搬不可重建；engine 侧我们只实现 layout service，不替换 service 层与扩展渲染（决定 3）。

### 4.6 工作区与持久化

- **一个窗口一个工作区**，切换 = 导航（重载）：`workspace.id` 在 `create()` 时定死（IndexedDB key + profile 选择）。
- **多窗口同一工作区天然支持**：扩展宿主按 `reconnectionToken` 每连接一个；server 要保的是工作区存在性与会话（`reconnection-grace-time` 默认 3 小时）。
- **UI 状态两份**：per-window（frame 布局，`ui-layout` 的 `createSnapshotStore`，key `prac-layout/v1`，**带版本**）与 per-workspace（VS Code 自己的 IndexedDB，按工作区 id，跨连接存活）。**per-workspace 的 frame 状态仍未做。**
- localStorage 是 per-origin：同源两个 tab 共用一份 per-window 状态。

### 4.7 验证的分工（决定 21）

| 层                                           | 住哪                                 | 断言什么                                                                                              |
| -------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **单测**（`vp test`，vite-plus 内置 vitest） | 各包 `*.spec.ts`                     | 机制：纯函数与纯算术（区域树重写、尺寸分配、折叠与缓存尺寸、子序、clamp、编排"只填空缺"、持久化往返） |
| **活体门（prac）**                           | `tests/gates/`                       | `verify:stack` / `verify:bottom` / `verify:persistence` / `verify:split`                              |
| **活体门（VS Code 侧）**                     | `vendor/vscode/scripts/verify-*.mjs` | 产物过真 loader、part/view 挂进搬出 prac 区域并画出像素、扩展真的激活、能力面契约                     |
| **独立页**                                   | `vscode:smoke`                       | 无 bridge 的默认路径（workbench 自己挂 part）仍然工作                                                 |

规则：**机制断言只进单测**；要加一条活体断言，先写清"单测为什么证明不了它"。代价必须记住：单测看不见"模型对了、渲染器没跟上"的假绿（曾发生：载荷漏了 `mountViewInto`，全员绿）——所以**每个能力在活体层至少留一条渲染断言**。

## 5. 边界与缺口（诚实的现状）

**已实现**：frame（区域树 / sash / 堆叠 / 折叠 / 底栏 / 任意方向分栏 / 持久化的 per-window 半）· 视图目录与注意力 · 一次/页的 VS Code 启动与 part/view 宿主 · 座位 `vscode:editor` / `vscode:sidebar` · 文件编辑面（决定 17 的单位）与 stage 的 tab 条 · 能力面 `editors` / `diagnostics` · 扩展基座（`server` 目标，第三方扩展可激活并有像素）· 同源路由与代理 · 单测 + 两层活体门。

**未实现 / 已知缺口**：

- **agent 能力面没有任何实体**（工具 / 上下文 / 呈现三类都还没有）。
- **`vscode_diagnostics` 的 host 侧**：浏览器侧读的是渲染器镜像；要让 host（进而 agent）拿到，需要在**扩展宿主**里放适配器（唯一能调扩展 API 的地方，可用任意 node 通道与 host 通信）——门还没选。
- **对话框/通知的座位**：prac 的组合里没有通知面，于是需要确认的路径（装扩展、关脏文件、信任提示）会**永久挂住**。
- **tab 的 `×`（关闭入口）**与预览态斜体的活体验证。
- **`documents` 能力**（缓冲区内容 / 选择 / 版本）还没有——它是"上下文注入"的前提。
- **内建扩展编译 12/106**（`extensions/ipynb` 的 typecheck 挡住 `build-fast-extensions`）；git / search / emmet 等在服务端不可用。
- **per-workspace 的 frame 状态**；两个 tab 共用 per-window 状态的边界。
- **扩展安装的正当路径**仍被环境守卫挡着（要等 VS Code 终端提供 `VSCODE_IPC_HOOK_CLI`）。
- **两处 native / 可选缺口**（非阻塞）：`@vscode/fs-copyfile`、`spdlog`、`vsda` 缺失；两个可选客户端模块 404。
- **code server 的 `--folder` 与 DSH 工作区**：rig 里两者目前不是同一个目录（活体门的期望值因此按数据相对来算，不按固定路径）。
- **两个服务端尚未合一**（DSH 一个、code server 一个），以及 step B 未完的共享常量（view id 仍有 6 处字面量、`/prac-vscode` 仍两处拼写）。

**权限 / 授权边界**（不是技术缺口，是有意关上的门）：手工解包 VSIX 装扩展、绕过 `server-cli` 的守卫——都属于"绕过有意关上的门"，需人类裁决，不自行改道。

## 6. 相关

- [philosophy.md](philosophy.md)：两个轴 + 认识论循环 + 决策单元。
- [.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md](../.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md)：VS Code × DSH 融合的**决策表**（含被否决的路线）与全部核实事实。
- [.agents/notes/proposed/2026-09-15-vscode-capabilities-into-prac.md](../.agents/notes/proposed/2026-09-15-vscode-capabilities-into-prac.md)：能力面（`Capability<T, A>`）的理想形态与三步。
- [.agents/notes/proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md](../.agents/notes/proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md)：六件事在 DSH 机制上的落点（提案，未落地）。
- `vendor/vscode/README.md`：上游 pin、补丁集、overlay、构建与验证的全部细节。
- [.agents/notes/resolved/2026-09-13-vs-concept-boundary.md](../.agents/notes/resolved/2026-09-13-vs-concept-boundary.md)：概念边界与命名（Step A/B 的依据）。
