# Prac 的目标架构

> 面向目标的设计。实现进度、差距与踩坑见 [.agents/notes/](../.agents/notes/)；理念见 [philosophy.md](philosophy.md)。

---

## 1. 目标

### 1.1 为什么做 prac（设计的出发点）

1. **责任要放对地方**：AI 只做**有界认知**（感知当下、生成、局部转换——短单元、可验证）；人负责意图、高杠杆处的判断与真实校验；harness 负责**账本**（外部、持久、可核实的事实，不信任模型的自我报告）。责任永远在人，harness 的价值是让责任**可行使**（暴露推理、可验证、可回滚），而不是**可甩脱**。
2. **能力边界要分清真伪**：区分**真天花板**（模型确实做不到）与**假天花板**（rig 没给够工具、上下文、权限）。假天花板是要修的机会，不是结论。这要求 harness 能把"手上的事实"和"可能的动作"都摊在台面上。
3. **组织方式是认识论循环**：`决定 → 验证 → 重审`，不是 `计划 → 执行 → 交付`。计划是活的假设，会被现实证据击打后重修。
4. **两个生态都要用上**：harness 侧要 DSH 的**成熟骨架与生态**，IDE 侧要 VS Code 的**完整能力与生态**——而且不是"用一个包另一个"，是**把两边都拆散、按 prac 的目标重新组装**。

### 1.2 目标

prac 要做的是**一个供人和 agent 共用的工作台**：DSH 提供 harness（模型、工具、会话、审批、沙箱），VS Code 提供**完整的 IDE** 能力与生态（编辑、语言特性、搜索、源码管理、调试、任务、测试、终端、扩展），两者合成一个系统。

这个合成是**两端**的：**server 侧跑着 agent 与 harness，并且拥有完整的 IDE 能力**——所以 agent 能直接使用它们；**client 侧是人的界面**，由 prac 自己编排，VS Code 的 UI 在其中只是组件。**主干是 DSH**，prac 自己的部分与 VS Code 都以插件的形式挂在它上面。

### 1.3 三条不变量（架构变更的判据）

1. **不 fork DSH**：改变行为走它自己的组装层（bundle / profile / patch）。
2. **不 fork VS Code 源码树**：只 pin + patch + overlay，源码不进本仓，改动要小到可审计。
3. **不引第三方改造**（`monaco-vscode-api` / Theia 之类）：直接对官方 Code - OSS 下手。

---

## 2. 总体形态

### 2.1 两端：client 与 server

架构按两端看：**client** 与 **server**。DSH 与 VS Code 各自都同时有这两侧的部分，所以不能按系统来切分（§4）。

DSH 在两端都提供骨架：client 侧是页面的壳（loader、模块表、槽、服务注册表），server 侧是 harness 与进程（§2.2）。

### 2.2 主干是 DSH

组合、状态、进程、生命周期都归主干。DSH 在两端都提供骨架，prac 与 VS Code 的插件按各自所属的一端挂上去：

| 端         | DSH 作为主干的具体形态                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| **client** | **页面的壳**：loader 与模块表、`ctx.slots`、服务注册表、boot 注入——prac 的 frame 与座位挂在它的壳上         |
| **server** | **harness 与进程**：Cordis 插件树（host 插件）、profile / bundle / patch 组装、服务、agent loop、子进程管理 |

**DSH 的扩展方式就是插件**：Cordis 插件树（加上运行时的动态包）——host 半边在 Node、client 半边在页面，同一地址空间，耦合是 in-process 的 `inject`。

给 agent 的能力：DSH 侧是写一个插件挂进主干（工具 / 上下文 / 呈现三类）；VS Code 侧必须经过它的扩展宿主（唯一能调 `vscode.*` 的地方）。

主干的组装机制（profile → bundle → patch，按行 id 定位、可 insert / 可 disabled）就是 prac 的定制方式：定制表现为组装，不是改内核。

### 2.3 prac 自己写什么，继承什么

| 组成                  | 是什么                                                                                                                            | 目标                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **主干（DSH）**       | harness 本身：agent loop、会话与 session log、工具运行时、上下文、审批与沙箱、设置、凭据、持久化                                  | **直接继承**，不重写                                |
| **prac 自己写的插件** | ① **frame**：一个通用多区域容器（区域树 / 分割 / 堆叠 / 折叠 / 底栏 / 视图目录 / 持久化）② **编排与角色**：谁放哪、注意力、快捷键 | 界面形态由 prac 拥有，不被任何一方绑定              |
| **agent 面**          | 六件事的落点：决策空间、依据一等公民、可逆检查点、审查主界面、架构记忆、活的计划                                                  | **立身之本**；先以纯消费者身份塞进 DSH 的扩展点     |
| **VS Code 集成族**    | 一组插件 + 它依赖的 lib 与 vendor（§3）                                                                                           | 引入**完整的 IDE** 能力与生态——**重要，只是一部分** |

### 2.4 一张图

```mermaid
---
title: 主干 = DSH，两端各一半。
---
flowchart TB
  subgraph client["client（浏览器里的一页）"]
    dshClient["DSH 的 client 半边：web shell（loader / 模块表 / ctx.slots / 服务注册表）"]
    pracClient["prac 的 client 插件：frame（区域树 / 分割 / 折叠 / 目录 / 持久化）· 编排与角色 · 能力面的消费端"]
    vsClient["VS Code 插件的 client 半边：VS Code 的 UI 组件"]
    dshClient --> pracClient
    dshClient --> vsClient
  end
  subgraph server["server（Node）"]
    dshHost["DSH 的 host 半边：agent loop · 会话 · 工具 · 上下文 · 审批 · webserver"]
    pracHost["prac 的 host 插件：服务与策略 · 能力面的提供端 · 进程生命周期"]
    vsServer["VS Code 插件的 server 半边：拥有 code server"]
    codeServer["code server 进程：完整的 IDE（编辑 / 语言特性 / 搜索 / 源码管理 / 调试 / 任务 / 测试 / 终端 / 扩展）"]
    extHost["扩展宿主进程（VS Code 的扩展跑在这里）"]
    ptyHost["PTY host 进程"]
    dshHost --> pracHost
    dshHost --> vsServer
    vsServer --> codeServer
    codeServer --> extHost
    codeServer --> ptyHost
  end
  client <-->|"DSH 的通信层：页面上屏与产物 · 服务调用 · 事件与流"| server
```

---

## 3. VS Code 的集成

### 3.1 一组插件，按同一条轴切成两半

**不是"一个插件"，是"一组插件"**——我们基于 `vendor/vscode-embed` 开发**一组插件**（它们住在 `packages/*`，与 prac 自己的插件并列）。**VS Code 自己也按 prac 的两端切成两半**：

| VS Code 的那一半      | 在 prac 里是什么        | 提供什么                                                                       |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| **code server**       | **server 侧的 remote**  | **完整的 IDE**（编辑、语言特性、搜索、源码管理、调试、任务、测试、终端、扩展） |
| **web**（web bundle） | **client 侧的 UI 组件** | **UI**                                                                         |

### 3.2 三层

| 层                                      | 是什么                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------ |
| `vendor/vscode`                         | 引入的 VS Code 源码树 + 我们的 patch（pin / patch / overlay / 构建配方） |
| `vendor/vscode-embed`                   | 在它之上封装的可复用 lib：把 VS Code 变成可被程序驱动的部件，不绑定 prac |
| **VS Code 插件族**（住在 `packages/*`） | 基于这个 lib 构建的一组插件——把 VS Code 的能力与生态带入 prac 的地方     |

**lib 与插件的分工**：lib 只提供机制（资产服务、启动、宿主元素工厂、能力面的骨架）；政策在插件层（谁放在哪、何时启动、哪个 view 用哪个 part、能力怎么给 agent、进程生命周期）。

### 3.3 通信层：基于 DSH 的架构设计（§7 的待设计项）

**两半之间的通信层要基于 DSH 的架构重新设计**——**不是**把 VS Code 自己的传输（管理连接、扩展宿主连接、资源 HTTP）从浏览器透传到 code server。

设计约束：

- 主干的 remote 面是"**host 声明方法、client 调用**"，反向只有**转发事件**（其中 waterfall 类事件可携带回答），**没有通用双向 RPC**；
- 现成的双向载体是**流复用**（`/api/remote.mux`）：要承载双工有状态协议，得由插件注册端点并自己定帧；
- **VS Code 的 extHost 协议不应跨越 prac 的 CS 边界**——它属于 server 侧内部（code server ↔ 扩展宿主）。

### 3.4 UI 组件的边界

"client 侧提供 UI 组件"要落到**组件**这一级，不是把整个 workbench 搬进页面。

组件的边界（编辑器控件到哪、tree / 终端 / 面板这些整块 UI 怎么办、哪些必须由 server 侧数据驱动）是 §7 的待设计项。

---

## 4. 两端的设计

### 4.1 每端有什么

|                   | **client（浏览器里的那一页）**                                    | **server（Node 进程）**                                              |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| **DSH**           | web shell（loader / 模块表 / `ctx.slots`）+ prac 自己的客户端插件 | host 插件（工具 / 上下文 / 会话）+ webserver                         |
| **VS Code**       | **UI 组件**（VS Code 插件的 client 半边）                         | **code server = remote**（完整的 IDE）+ 扩展宿主进程 + PTY host 进程 |
| **prac 自己写的** | frame、编排与角色、注意力、能力面的消费端                         | 路由、服务策略、能力面的提供端、进程生命周期                         |

### 4.2 状态住在哪一端

| 状态                              | 归     | 理由                            |
| --------------------------------- | ------ | ------------------------------- |
| 工作区注册表 / 会话 / session log | server | agent 要用；跨窗口共享          |
| 工具与 agent loop                 | server | agent 住在 server               |
| 扩展与其激活状态                  | server | 扩展宿主是 VS Code 生态的落点   |
| 终端（PTY、scrollback）           | server | 跨断线保活；人机两侧都可附着    |
| **IDE 能力（诊断、语言特性…）**   | server | agent 要直接取用                |
| **编辑器缓冲区与模型**            | server | 同上；client 只持有渲染用的视图 |
| **打开的文件集合**                | server | 工作区里正在发生什么            |
| frame 布局                        | client | 纯呈现状态，per-origin 即可     |
| VS Code 自己的 UI 状态            | client | 纯呈现状态，按工作区 id 隔离    |

### 4.3 端之间的线

| 线                   | 载体                                          | 内容                                            |
| -------------------- | --------------------------------------------- | ----------------------------------------------- |
| **页面上屏与产物**   | HTTP（同源静态 + 启动注入）                   | HTML、`client.js` 产物、boot 图                 |
| **服务调用**         | DSH 的 remote 面（client 调 host 声明的方法） | 能力面、会话、工作区、工具结果                  |
| **事件与流**         | 转发事件（host→client）+ 流复用               | 状态变化、流式输出、受限的反向回答（waterfall） |
| **VS Code 两半之间** | **基于 DSH 的架构设计**（§3.3、§7）           | IDE 能力 ↔ UI 组件                              |

### 4.4 设计原则

1. **IDE 能力必须能在 server 侧取到**：agent 在 server 侧；能力只存在于 client 侧时，agent 只能拿到被页面把关的、有损的视图。
2. **同一条状态不在两端各存一份**：跨窗口共享的状态放 server；服务端的共享单元是**连接**，不是页面。逐条所在地见 §4.2。
3. **UI 与 agent 读同一份能力数据**（`snapshot` / `subscribe` / `settled` / `version` / `actions`），不是各自问一份；没有 view 挂载也能回答；不开 `executeCommand` 后门。

---

## 5. 依赖的两个系统提供什么

### 5.1 DSH 提供

| 能力         | 形态                                                                                           | 设计怎么用                                                            |
| ------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **插件**     | Cordis 插件（`apply(ctx)`、`inject` / `provide` / `effect`，卸载可逆）                         | prac 的每一行（**这是 DSH 自己的扩展方式，不是 VS Code 的扩展宿主**） |
| **组装**     | profile → bundle → patch（按行 id 定位、insert / disabled、`--dump-config`）                   | 把 prac 与 VS Code 插件装进主干；不动内核                             |
| **双平面**   | host 半边（Node ESM）与 client 半边（loader 产物）                                             | 能力在 host、UI 在 client（§3.1）                                     |
| **页面外壳** | `ctx.slots` 命名槽 + 服务注册表（消费方 pending 直到提供方出现）                               | prac 的 frame 与座位；跨插件传面                                      |
| **协议**     | remote（host 声明、client 调用）+ 转发事件 + 流复用                                            | 服务调用、状态变化、以及 §3.3 要设计的通信层                          |
| **服务面**   | 工具（`ctx.tools.register` / `defineTool`）、会话、session 投影、资源（client 侧）、快照 store | agent 面（工具 / 上下文）、frame 的持久化                             |

**渲染架构**：以下 file:line，除写明「本仓」的，都在 DSH checkout 的 `packages/**` 里。`dsh web` 到像素是一条单向链：服务页面 → 注入 boot 图 → 浏览器内核 → 模块系统 → Cordis Loader → 插件 `apply` → 槽注册 → React 渲染。

```mermaid
flowchart TD
  A["dsh web：webserver + frontend-static 供 index.html"] --> B["client-modules 产出注入行：__ModuleLoader__ 队列 + 预载 + __DSH_BOOT__"]
  B --> C["apps/web 入口：AppWebEntry.run()"]
  C --> D["模块系统：9 词 seed 表 + boot 图"]
  D --> E["Cordis Loader：逐行 import 与 apply"]
  E --> F["client.js lazy-CJS envelope 物化"]
  F --> G["插件 apply：ctx.slots.register / provide"]
  G --> H["ui-renderer：renderSlot('root')"]
  H --> I["像素：React 组件树"]
```

| 环节            | 是什么                                                                                                                                                        | 证据（DSH checkout）                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **服务页面**    | `dsh web` 是 `--profile web` 的别名；web profile 在 `dsh-web-app` 之上叠行                                                                                    | `apps/cli/src/args.ts:175`；`packages/bundle/web-app/cordis.patch.yml:135-161`                                                                                                                       |
| **页面注入**    | webserver 把 dist 的 `index.html` 过一遍结构化注入表；`frontend-static` 是读 dist 的 fallback                                                                 | `packages/host/webserver/src/index.ts:347-361`；`packages/host/frontend-static/src/index.ts:120-142`                                                                                                 |
| **boot 图**     | `client-modules` 的 node 半边扫 Loader 行里的 `dsh.client` 包，合成 boot 图并产出注入行（队列、预载、blocking bootstrap、`__DSH_BOOT__`）                     | `packages/client/modules/src/index.ts:474-509`、`:578-580`；声明字段 `packages/util/package-manifest/src/types.ts:43-57`                                                                             |
| **浏览器入口**  | Vite 入口对 `#root` 跑 `AppWebEntry`                                                                                                                          | `apps/web/src/main.ts:1-6`                                                                                                                                                                           |
| **boot 内核**   | 等 `__DSH_BOOT_READY__`、取 `window.__ModuleLoader__`、用 seed 表与 boot 图建模块系统；挂 Loader 并 `loader.internal = modules`；逐行 `loader.create`         | `packages/client/web/src/boot.ts:46-85`、`:113-135`                                                                                                                                                  |
| **seed 表**     | 9 个平台词 → shell 的静态导入                                                                                                                                 | `packages/client/web/src/seed.ts:24-38`；词表 `packages/client/web/src/platform.ts:8-14`                                                                                                             |
| **loader 产物** | 每个 client bundle 是 `window.__ModuleLoader__.load({id, factory})` 的闭包工厂；加载只注册工厂，物化才跑模块体；`require` 解析顺序 seed → 已物化 → 已注册工厂 | `packages/client/tsdown.client.ts:566-568`；`packages/client/modules/src/client/system.ts:172-192`、`:200-213`                                                                                       |
| **插件行**      | Loader 按 Cordis 服务依赖定激活顺序，import 后跑 `apply`；未激活的行在 boot 审计里报错                                                                        | `packages/client/web/src/boot.ts:124-135`、`:138-158`                                                                                                                                                |
| **槽**          | 插件在 `apply` 里 `ctx.slots.register(...)`                                                                                                                   | `packages/client/ui-layout/src/client/index.ts:148-158`；`packages/client/ui-conversation/src/client/apply.ts:388-393`                                                                               |
| **渲染**        | `ui-renderer` 安装槽渲染器并提供 `ctx.uiRenderer.mount`；boot 用 `inject(['uiRenderer'])` 挂载；React 树从内置 `root` 槽起                                    | `packages/client/ui-renderer/src/client/index.ts:88-96`；`packages/client/web/src/boot.ts:95-101`；`packages/client/ui-renderer/src/client/app.tsx:21`、`registry.ts:43`、`scoped-slots.tsx:895-931` |

**UI 组装原语**：

- `ctx.slots` 是**命名槽注册表**。一次 `register({ name, key?, children?, store?, inject? }, Component)` 同时声明该组件允许渲染的 child 槽（声明即独占授权）。槽有四种形态：`single`（单占用）、`list`（有序列表）、`keyed`（按 key 分派）、`chain`（条目自选）；作用域三种：`root` / `session-maybe` / `session`（`packages/client/ui-slots/src/index.ts:97-101`、`:149-155`；注册入口 `packages/client/ui-renderer/src/client/registry.ts:607-612`）。所以不是只有单值 / 列表两种。
- `root` 是内置的单值槽，只有 shell 从 ctx 层渲染它（`registry.ts:43`、`:349-356`）。
- **贡献一个 view / panel**：在 `apply` 里注册。进 `main`（keyed）的一个 key 就是一个中央面板——`ui-conversation` 注册 key `conversation`（`ui-conversation/src/client/apply.ts:388-393`）；进 `sidebar` / `rightbar`（single）就占据整列，进 `shell.overlay`（list）就叠在整帧之上（`ui-layout/src/client/index.ts:61-91`）。父组件在自己的渲染点用 `renderSlot('<key>', ownerProps)` 取出来（`ui-layout/src/client/AppFrame.tsx:40-42`、`:193-227`）。
- **由什么渲染**：React 18（`packages/client/ui-renderer/package.json:54-55`；锁定 18.3.1）。注册的组件是函数组件——渲染器按 `FC<InjectedProps>` 取用并以 JSX 展开（`scoped-slots.tsx:505`、`:510`、`:548`）。四种形态的分派在 `scoped-slots.tsx:801-812`（single / keyed）与 `:814-834`（chain）。
- **样式**：CSS Modules 在 bundle 内用 lightningcss 编译，工厂执行时注入带 `data-plugin` / `data-plugin-css` 的 `<style>`，类名是 hash（`packages/client/tsdown.client.ts:33-53`、`:502-525`）；全局 css 走同一注入器（`:542-556`）。主题别名 token 是 `--dsw-*`，由 `ui-layout` 的 presenter 写到 `document.body`（`ui-layout/src/client/index.ts:171-181`）。

| 包              | 负责                                                                                                                       | 形态                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `ui-slots`      | 命名槽的纯核心（声明、注册、四种形态、load 期校验），无 React                                                              | 静态链接库，也是 seed 词 |
| `ui-primitives` | 共享 React 原子（控件、图标、Markdown / 终端 / diff 等输出卡片），零 Cordis、只用 token                                    | 静态链接库，也是 seed 词 |
| `ui-dockkit`    | 停靠布局引擎（分割树 + 标签页 + 撤销历史）与组件；右侧栏是它的嵌入者                                                       | 静态链接库，也是 seed 词 |
| `ui-layout`     | 固定三列 AppFrame、列宽常量、`ctx.layout`、主题 presenter，并声明 `sidebar` / `main` / `rightbar` / `shell.overlay` 四个槽 | 一个 client 插件行       |
| `ui-renderer`   | 唯一把裸 observable 绑成 React hook、持有 React context、渲染 `root` 的包                                                  | 一个 client 插件行       |

（证据：`packages/client/ui-slots/README.md`、`ui-primitives/README.md`、`ui-dockkit/README.md`；`packages/client/ui-primitives/tsdown.config.ts` 与 `ui-dockkit/tsdown.config.ts` 都调 `staticLinked`；`ui-layout/src/client/columns.ts:11-29`、`service.ts:28-51`。）

**状态与数据**：

- `dsh-client-store` 是 React-free 的快照 store 引擎：`createSnapshotStore`（`getSnapshot` / `subscribe` / 生效方式）、`defineStore`（init + actions 声明表），可按名持久化到 localStorage（`packages/client/store/src/index.ts:103`、`:217`；契约 `packages/client/store/src/contract.ts:3-14`）。渲染侧只有 `ui-renderer` 把它绑成 React hook；业务组件不自己订阅。
- remote / typert：host 用装饰器声明方法并生成 descriptor；client 在 `apply` 里 `ctx.remote.$mount(contribution)`，得到 `ctx.remote.<namespace>` 的方法与 stream（`packages/api/remotes/src/client/index.ts:143-158`）。**它不直接进 React**：转发事件经 `ctx.remote.$on(...)` 更新 client 数据层（会话 / 工作区模型），模型再经 UI adapter 变成槽的标准 hook 或 store（`packages/api/session-controller/src/client/index.ts:102-107`）。分层与数据路径见 DSH 的 `docs/subsystems/web-client.md`。

**平台模块表（9 个词）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`（`platform.ts:8-14`，逐一对应 `seed.ts:28-38` 的静态导入）。

- 为什么是这 9 个：四个 React 入口 + Cordis + 四个静态 client 库。它们是有运行时身份、必须只有一份的东西；其余依赖要么内联进各自的 bundle，要么由 `dsh.client.external` 逐包声明。
- 保证了什么：seed 的值是 shell 的静态导入，所以每个 bundle 拿到同一实例（`seed.ts:1-8`）；词表是单一真源，seed 表、tsdown externals、Vite alias 都消费它，模块身份不会漂移（`platform.ts:1-5`）。
- 两侧的强制：构建期把这 9 个（baseline）留成 external，非 baseline 的 workspace value import 被纯度门拒绝（`tsdown.client.ts:406-416`、`:482-500`）；运行期 `require` 先命中 seed，未命中就抛（`client/system.ts:200-213`）。

**prac 替掉了哪一层**：

- 替掉的只是 `ui-layout` 这一行：本仓的 `packages/bundle/web-app/cordis.patch.yml:9-10` 把它 `disabled: true`，`:15-16` insert `prac-client-ui-layout`。
- DSH 的 `ui-layout` 提供的是一个**固定三列壳**，不是区域树：列宽常量在 `columns.ts:11-29`，`ctx.layout` 的面在 `service.ts:28-51`，四个槽在 `index.ts:148-158`。分割树 / 标签页在 `ui-dockkit`，由右侧栏使用。
- prac 的 `prac-client-ui-layout` 占同一个内置 `root` 槽，重新声明 `sidebar` / `main` / `rightbar` / `shell.overlay` 四个槽并加一个 `prac.view` 列表座位；视图身份是 `<source>:<name>`，`dsh:` 直接映射 DSH 自己的槽，其它来源由 `prac.view` 声明（本仓 `packages/client/ui-layout/src/client/index.ts:92-106`、`catalogue.ts:23-40`）。`ctx.layout` 保留为 compat shim，按 arrangement 绑定的角色把位置词汇翻译成放置（`index.ts:33-37`；`contract.ts:351` 的 `bindRoles`）。
- 替掉之后**仍然继承**：`ui-renderer`（React 槽渲染与唯一 ctx 层 `renderSlot('root')`）、`ui-slots`、`dsh-client-store`、`ui-primitives`、`ui-dockkit`、`client-modules` 与 Cordis Loader、服务注册表（`provide` / `inject`，消费方 pending 直到提供方出现）、remote 与转发事件。prac 的 patch 只动了 `ui-layout` 一行，没有替换这条链上的任何其它环。

**未核实**：

- 任务里提到的 `clientPack` 在 DSH checkout 里搜不到（`packages/**` 只有 typert 测试里的局部变量 `clientPackage`）。这里按实际存在的两个名字写：client bundle 的 `__ModuleLoader__.load` 闭包工厂封装，以及 `dsh.client` 声明。
- prac 自己的 client bundle 由 `vite.config.ts` / `scripts/pack-client.ts` 的 pack 产出（本仓 `packages/client/ui-layout/src/client/index.ts:44-48`），与 DSH 的 `tsdown.client.ts` 不是同一条构建链；两条链产物的 envelope 是否逐字节同形，没有对比。
- 9 个词里每个词「必须是共享单例」的逐条判据，代码里只有 seed 注释与 baseline external 规则；`ui-primitives` / `ui-dockkit` 是否仅为去重而非身份必需，未核实。

设计只依赖约定：`dsh` 字段的三个角色（bundle / client / profile）、patch 语义、loader 产物形状、平台词表、`provide` / `inject` 的等待语义、命名槽、快照 store 的持久化。不依赖实现细节：具体行 id、API 包的导出名、快照字段的形状。

### 5.2 VS Code 提供

| 能力                 | 形态                                                                                            | 设计怎么用                                      |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **完整的 IDE 能力**  | code server（remote）：编辑、语言特性、搜索、源码管理、调试、任务、测试、终端、扩展             | server 侧 remote（§3.1）                        |
| **扩展生态**         | 扩展宿主进程 + extHost 协议 + 贡献点 + 市场                                                     | 能力来源；也是"能力层暴露给 agent"的接入点      |
| **UI 组件**          | web bundle 里的编辑器控件、工作台部件与视图（`CodeEditorWidget`、part / view container / view） | client 侧的组件（§3.4）                         |
| **可组合的缝**       | `create()` 的构造选项、可覆写的 workbench 组合、`IWorkbenchLayoutService`、模块级命令面         | 让 prac 拥有布局与编排，而不是被 workbench 拥有 |
| **pin + patch 形式** | 源码树 + 我们的 delta（patches）                                                                | 改动可审计（不变量 2）                          |

**采用哪种运行形态**：VS Code 有四种形态，prac 只用**第三种**——[_"UI in the browser, extensions run in code server"_](https://github.com/microsoft/vscode/wiki/How-to-Contribute)：

| 形态                                             | UI 在哪 | 扩展在哪               | prac                                                                    |
| ------------------------------------------------ | ------- | ---------------------- | ----------------------------------------------------------------------- |
| `code-web`（`--target web` 单独跑）              | 浏览器  | 浏览器的 web worker    | ✗ 只有 web 扩展：终端 / 调试 / 任务 / 源码管理都不可用                  |
| **code server（`--target server` + 浏览器 UI）** | 浏览器  | **服务端的 Node 进程** | ✓ **就是它**：完整扩展生态，且能力天然在 server 侧                      |
| `server-web` / `reh-web`（server 自带客户端）    | 浏览器  | 服务端 Node            | ✗ 与"DSH 发前端"重合；它的 product 还被 `tweakProductForServerWeb` 改过 |
| `desktop` / `reh`（Electron / 远程开发包）       | 桌面    | 本地或远端 Node        | ✗ 不做桌面应用，也不给桌面 VS Code 当 remote                            |

因此构建只要**两个目标**：`--target web`（浏览器里的 UI，由 DSH 发）与 `--target server`（code server，扩展宿主在这里）。桌面、`server-web`、`reh*` 一律不构建。

---

## 6. prac 自己的机制

### 6.1 frame

一个**通用多区域容器**，不认识任何具体视图：区域树 + 分割（任意方向，**以 view 为主语**，因此任何方向都造不出空区域）+ 堆叠 + 折叠（记尺寸）+ 常驻底栏 + 视图目录（`prac.view` 槽）+ 持久化。

视图契约、树形摆放、收起记宽这类做法借鉴上游，frame 由 prac 拥有（[umbrella note](../.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md) §3.3）。

### 6.2 编排与角色

默认视图与默认落位、角色绑定、注意力（调出面 / 快捷键）、**只填空缺**的默认放置语义（默认放置不能覆盖已恢复的状态）。

### 6.3 能力面

一套 `Capability<T, A>` 同时服务 UI 与工具（§4.4 原则 3）。

### 6.4 agent 面（立身之本）

六件事各自的落点与优先级见 [proposed/2026-09-16-…](../.agents/notes/proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md)：**优先以纯消费者身份**把它们塞进 DSH 现有循环的扩展点（工具 + 上下文 + 呈现）；只有确需驱动轮次结构本身，才考虑更深的介入，且要显式记录。

### 6.5 怎么知道设计成立了

| 检查                         | 断言什么                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| **单元测试**（`vp test`）    | 机制：纯函数与纯算术（区域树重写、尺寸分配、折叠与缓存、子序、clamp、编排语义、持久化往返）          |
| **在浏览器里跑真页面的检查** | 真页面才能证明的事：产物过真 loader、部件/视图挂进搬出 prac 区域并画出像素、扩展真的激活、能力面契约 |
| **每条能力一条渲染断言**     | 拦住"模型对了、渲染器没跟上"这类单元测试看不见的假绿                                                 |

---

## 7. 尚未定的设计（下一件工作）

1. **通信层的具体设计**（§3.3）：能力以什么形状暴露（服务 / remote / 工具）、谁定帧、双工协议怎么承载、状态归谁。
2. **UI 组件的边界**（§3.4）：编辑器控件算到哪里；tree / 终端 / 面板这类整块 UI 是"组件"还是"部件"；它们的数据从哪来。
3. **插件族的划分**：server 侧一族与 client 侧一族各有哪些插件、边界划在哪（什么算一个插件）。
4. **code server 的生命周期**：谁起、谁重启、谁关、端口怎么给（主干拥有的具体形态）。
5. **能力面的清单与演进**：除 `editors` / `diagnostics` 之外要哪些（`documents` 一类），以及"给 agent 用"与"给 UI 用"是否需要不同的形状。

## 8. 相关

- [philosophy.md](philosophy.md)：两个轴 + 认识论循环 + 决策单元（§1 的出发点）。
- [.agents/notes/](../.agents/notes/)：决策记忆——每个「为什么 + 放弃了什么」，以及**实现进度、差距与踩坑**。
- [in-progress/2026-09-09-vscode-dsh-integration.md](../.agents/notes/in-progress/2026-09-09-vscode-dsh-integration.md)：本文件 §1–§4 的设计出自它的决定 22。
- [proposed/2026-09-15-vscode-capabilities-into-prac.md](../.agents/notes/proposed/2026-09-15-vscode-capabilities-into-prac.md)：能力面的形态与三步。
- [proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md](../.agents/notes/proposed/2026-09-16-epistemic-six-on-dsh-mechanisms.md)：六件事的落点（§6.4）。
- `vendor/vscode/README.md`：上游 pin、补丁集、overlay、构建与验证的细节。
