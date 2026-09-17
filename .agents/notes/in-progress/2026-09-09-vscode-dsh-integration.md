---
status: in-progress
---

# Agent Note: prac 的界面形态 —— VS Code × DSH 融合

> 这是这项工作的 **umbrella**：主线定义、需求约束、决定（含被否决的路线）、开放问题。
> **依据**（里程碑与工作记录、现在的形态快照、已核实事实、踩坑、验证元教训）在 [工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md)——2026-09-17 从本 note 拆出，那时 5.7 万字符里 79% 是依据、决定只占 16%。**它不是 note**（没有状态轴、不签字）。
> 步骤 note：[2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)（概念边界与命名，实现已完成，待签字）；[../proposed/2026-09-15-vscode-capabilities-into-prac.md](../proposed/2026-09-15-vscode-capabilities-into-prac.md)（把能力拆散带入 prac，方案待裁）。
> 口径（**决定 21 删减后**）：**vendor 侧集成门**写作 **14/14 · 28/28 · 9/9 · 6/6 · 7/7 · 33/33**（layout · views · focus · regions · view · file）；第六门 `verify-extension` 是**条件门**（装了扩展才跑 5 项，没装时明确 `SKIPPED`——SKIP 不是通过）；**prac 侧活体门**写作 `verify:stack 6/6 · verify:bottom 6/6 · verify:persistence 6/6 · verify:split 11/11`；所有 part 计数一律 **8/8**；**单测**写作 `pnpm test`。

## 1. 这个工作是什么（主线定义）

1. **（2026-09-09）** 把 VS Code 与 DSH 结合成**一个**形态：prac 的界面 = agent 与 IDE **深融进一套 UI**，不是两套并列。保留**完整 IDE 能力与扩展生态**（Tier 2：语言包、GitLens 等 UI 扩展），**不要 VS Code 的布局**；以 agent 为中心，**IDE 是可按需下潜的重工具**。
2. **（2026-09-15）** **不是自定义 workbench，而是把基础能力拆散后带入 prac**：把 VS Code 的 **UI 层拆散**渲染进 DSH；**能力层**（如诊断）也要**暴露给 agent**；prac 同时利用 **VS Code 与 DSH 两方生态**。

**阶段切换**：此前在讨论 prac 的目标/理念，并以具体任务体验工作流（C1、C2）；进行到 C2 时 James 叫停，转入融合形态本身。叫停理由原文只有「我发现我们不应该再继续了」，推断是优先级——**待确认**。本工作**不欠**阶段二的那些机制（决策空间 / 以审决策为主界面）；它们要重新进入主线，需 James 重新裁决。

## 2. 需求约束（推导 UI 形态的前提）

### ① 协作模式（James 述）

- **共享工作空间 + 结对**：工作空间是 agent 与人**共有**的。流程：人提出想法/任务 → 两人在**一块白板（如 notes）**上讨论（细化、澄清目标、设计方案与计划）→ agent 实施（加工工作空间内容或把成果放回）→ 人旁观、可**打断**提醒纠偏、也会在 agent 需要时出现帮它操作 → review。变体：放手让 agent 自主完成一系列工作，或**叫停它自己上**。
- **白板与共识重要**；**保留工作记录、按需回顾**是更大的共识。
- **两个并行工作者、异步交流**：不共享同一个「当前阶段」⇒ **不是模式机**：没有「商定 / 实施 / 接管」这种要声明的状态。**谁在驱动是事实，不是状态**；**打断 = 说话 + 一个「停」**。
- **UI 是注意力的跟随器**：关注什么就把它拿到中间；换焦点要随手自然，并且要有**返回栈**。
- 三种角色（白板/记录、工件、对话）**不是三个固定格子**；**白板本身就是工作区里的文档**（notes 是文件）⇒ 白板与工件是同一种东西、只是角色不同 ⇒ 不需要两个面板。**恒在的是「环境」，不是「模式」**：导航（工作区/记录树）、**通道**（异步留言：你说的话等我看到）、**我在改什么**。
- 主场景 = **单工作区下持续、重度工作**；快速切换 / 同时多工作区更好，但不是主场景。

### ② 布局规格（James 定）

若 DSH 的布局能力有缺陷，**就基于它做我们自己的布局**（像改造 VS Code 一样）：主操作台 = 注意力焦点，四周是辅助操作面板；交流时 **chat 是焦点**，审阅计划/方案时**白板是焦点**且 chat 在一边随时可发消息，审阅工作区内容时**编辑器是焦点**、chat 在一边、资源浏览器在另一边；主操作台**可分栏**；**terminal 随时调出**；各窗口/视图**按需显示**、能方便隐藏收起与快速调出。

## 3. 决定

> **编号 = 引用句柄**（对话与其它 note 直接引"决定 14"），所以**只追加、不复用、不重排**；下面的主题导航只做索引。
> **主题导航**：与上游/补丁 `3 4 5 6` ｜ 边界与分层 `1 2 2b 7 8 9 10` ｜ 区域与布局 `14 15 16 20` ｜ 编辑器与文件 `17` ｜ 工作区与状态 `13` ｜ 生态与能力 `18 19` ｜ 工程 `11 12 23`
> **当前队列（建议顺序，未裁）**：~~`14`~~、~~**B1**~~、~~`18`~~（均已完成，见工作记录 §A 里程碑）→ frame 批次 `15 16 17 20` → 能力面（含上下文入）

| # | 决定 | 状态 |
| --- | --- | --- |
| 1 | DSH 页当 shell，VS Code 的 parts 挂进 DSH 的**真**布局 region（不 island 化） | 生效；L2 会把"挂哪一级"细化 |
| 2 | VS Code 的部件永远是被容纳的一方，经 host 挂进来，**不是搬过来** | 生效 |
| 2b | **容纳单位 = `view`**：prac 的 `prac.view` 目录里同时住着 **`dsh:*` 与 `vscode:*` 两方 view**，它们已经是同一种东西；**container（视图容器）是可选分组**、**part 是可选的高级形态**（整块标准 IDE 区域），都不是 prac 组合的单位 | **James 裁决 2026-09-15**。理由：用 part 当单位等于让 prac 说 workbench 的编排词汇，并继承它的"单实例 / 只能搬"约束 |
| 3 | 布局自己重做，但**只做便宜的那层**：parts 编排 + layout service 我们 own；**service 层 + 扩展渲染不拆**（拆 ≈ `monaco-vscode-api` 级改造，被"上游可控"否掉） | 生效——它是"保留完整生态"的落点 |
| 4 | 路线②：自写 workbench + layout service（不走 patch 经典 `Layout` 的路线①）；`IWorkbenchLayoutService` 按 prac 需要实现，模板 = `src/vs/sessions/` | 生效；**2026-09-15 补充**：补丁目标应从"换 composition"改成"把 workbench 从 app 变成 library" |
| 5 | 不 fork DSH；替换它的布局走它自己的组装层（bundle patch：`insert` / `disabled`） | 生效（`disabled` 必须排在 `insert` **之后**） |
| 6 | 不引入第三方改造（`monaco-vscode-api` / Theia），也不把源码树拷进项目；直接对官方 Code - OSS pin + 小而可审的 patch | 生效 |
| 7 | frame 由 `ui-layout` 拥有（选项 b）；**只借行为**（视图契约、`GridDescriptor` 的树形摆放、收起记宽、maximize、layout policy 的写法），不让 VS Code 的 grid 拥有 prac 的 frame | 生效 |
| 8 | 机制与组合分层：机制（`ui-layout`）/ 编排（`web-app`）/ VS Code 侧（vendor + 两个 prac 行）；机制层**不含任何具体视图名与默认落位** | 生效（2026-09-15 收束为 vendor 双子 + prac 两行） |
| 9 | 两个服务主次分明：`ctx.layout` 是**兼容 shim**（只服务 `ui-workspace`/`ui-sidebar`/`ui-sidebar-right` 用的 5 个方法，可整体删除）；`ctx.pracLayout` 是 prac 机制（含 `bindRoles`），机制**不知道谁是 sidebar** | 生效 |
| 10 | 命名：prac 自己的词自恰，借来的词带来源 | **已收束**（2026-09-13/15）：见 09-13 note 的分界线词表；原表把 `/prac-workbench` 当"借来的词"是分类错误 |
| 11 | 客户端半边用 TS + `vite-plus`（`vp pack`）；loader 外壳是**配置**（`pack` 数组每平面一条），不引 DSH 的 preset；产物不变量放 `run.tasks: check:client`（`vp staged` 只跑 git 暂存文件，`dist/` 是 gitignored）；源码级自定义 lint 规则只能写在**根** `vite.config.ts` | 生效 |
| 12 | profile `prac-dev`：三 bundle；prac 的包以 `link:` 挂 | 生效（2026-09-15 改名 `prac-host-vscode`） |
| 13 | **工作区是界面的一等关系**：单窗口 + **切换即重载**；**多窗口同一工作区要支持**；UI 上有**专门的工作区选择入口**（精确切换，也作初始落地页）；**未激活工作区**时 DSH 壳仍在、IDE 侧不启动；per-window 与 per-workspace 的 UI 状态分开，**多窗口同一工作区各一份**；**对话在创建时绑定工作区**（与 DSH 既有的 `WorkspaceView.sessionIds` 同向） | 生效；依据：`workspace.id` 在 `create()` 时定死（`storageService.ts:149`）；扩展宿主按 `reconnectionToken` **每连接一个**（`remoteExtensionHostAgentServer.ts:77`）；`reconnection-grace-time` 默认 **3 小时** |
| 14 | **对话是普通 view**：`dsh:main:conversation` 可被编排放到任意 region（默认侧边），注意力可把它提升到中间；`selectPanel` 只把**新选中的**视图放进编排给它的 region（默认中心），不再"替换当前 main 视图所在的那个 region" | **James 裁决 2026-09-15**。代价已读准：`packages/client/ui-layout/src/client/services.ts` 的 `selectPanel` 一处（约 5–15 行）＋一条编排默认（对话落哪 / 面板落哪）＋一条新断言（两者同时在屏且不同 region） |
| 15 | **区域的形态**：**常驻区**（`sidebar` / `rightbar`）不分栏、但**都可堆叠**（可折叠 header、排序、尺寸记忆）；**`stage` 的分栏必须带视图**（对齐 VS Code 的 editor group）；**新增常驻底栏**（`bottom`，默认收起，放 terminal / 输出 / 问题） | **James 裁决 2026-09-15**。堆叠 = `container` 在 prac 里的落点（`dsh:` 与 `vscode:` 的 view 可同列） |
| 16 | **持久化（最小集）**：区域尺寸 / 每个 view 的 `collapsed` / 堆叠顺序 / 哪些 view 在屏上；按决定 13 的两份 key（**per-window** 布局、**per-workspace** 展开项）；用 DSH `client-store` 的 `persist: { name }`。注意力栈与 recall 历史**不存** | **James 裁决 2026-09-15**；不做则堆叠与折叠每次刷新回默认。**2026-09-15 落地 per-window 那半**：`ui-layout/src/client/store.ts` = DSH `createSnapshotStore<LayoutState>(initial, { flush: "raf", persist: { name: "prac-layout/v1" } })` 的薄适配（key **带版本**：引擎恢复时**不校验**形状，形状变了就得换 key，不能让旧形状被读进来）；门 `tests/gates/verify-persistence.mjs` 16/16。**随之定下一条语义**：编排的默认放置**只填空缺**（`web-app/src/client/index.ts` 的 `arrange()` 跳过 `state.views` 里已有的 view），否则每次激活都把视图拖回出厂位、"持久化"自我撤销——临时去掉那条 `continue` 重跑，门立刻 5 项变红。**边界**：localStorage 是 per-origin ⇒ 同源两个 tab 共用一份状态；**per-workspace 那半仍未做**（现在没有 workspace 维度的 frame 状态） |
| 17 | **`stage` 提供 tab 与分栏；VS Code 侧提供的是“单个 file view”**：prac 里的“编辑器”= **一个文件的编辑面**（一个 view），**不是 editor part / editor group**；**tab 与分栏由 `stage` 提供**（⇒ **frame 级标签页要做**，且在 stage 内）。frame 本身仍不认识“编辑器组” | **James 裁决 2026-09-15**，修正我先前的推断（“不做 frame 级标签页”是错的）。理由：若用 VS Code 的 editor part（自带 tab 条与 group 模型），chat 与 editor 就无法在 stage 里自由并排。**后果**：L1 现在挂的 `workbench.parts.editor` 是**过渡形态**；lib 的 editor 句柄应定义为 `editor(file) → view`（B1 之后的 L2 工作） |
| 18 | **扩展基座换成完整 `server` 目标**：`build.mjs` 增加 `--target server`（**必须带 `--nls`**）的构建，host 与 code server 指向它；**验收判据 = 一个 Tier 2 扩展真的激活，且它的 UI 贡献出现在 prac 的 view 目录 / 区域里** | **James 裁决 2026-09-15**（先换基座、再验证生态）。已知坑（都在工作记录 §D 的踩坑表里）：`--out` 必须相对路径；数据目录要重定向；`product.json` 要盖章；`server-cli --install-extension` 被环境守卫挡住 ⇒ 装扩展要另有路径 |
| 19 | **terminal 用 VS Code 的**（完整 `server` 目标自带 PTY + shell integration + 扩展 API），它只是底栏里的一个 view；**agent 执行命令走 DSH 自己的 exec**，不与人那条终端共用（代价：agent 看不到人终端的输出，除非日后做桥） | **James 裁决 2026-09-15**；作废旧计划"纯 web 无 PTY ⇒ PTY 放 DSH host"（决定 18 换基座后其前提消失） |
| 20 | **`stage` 支持任意方向分栏**（上下左右、可嵌套） | **James 裁决 2026-09-15**（细化决定 15：stage 不止左右分）。**2026-09-15 已完成**：模型层的两轴早就能吃（`node.dir === "row" ? w : h` + 递归 `visit`），补的是门面与动作——① 面从 `split(regionId, dir?)` 改成 **`splitView(viewId, side)`**（`Side = left/right/up/down`）：**view 是主语**，机制为新区域**为这个 view** 而建，所以**任何方向都造不出空 region**（决定 15「分栏必带视图」）；`Side` 一个词同时决定轴与插入顺序（left/up 在前，right/down 在后），没有"只给轴不给侧"的含糊。② `splitRegionWith`（`model.ts`）纯函数：新区域一律 flex——源是 flex 时两半均分，源是固定尺寸时源保持尺寸、新区域吃 split 自己的余量。③ 用户动作在 recall 面的每个 view 行上：←↑↓→ 四个按钮（区域行的旧"分栏"按钮已删，它造的正是空 region）。④ 门 `tests/gates/verify-split.mjs` **25/25**：右/左两个相反方向都测（顺序分支不能只测一侧）、down 形成**嵌套** column split、竖 sash 真鼠标拖拽改尺寸、reload 后形状与尺寸都在。**注意力不必改**：编排的目标 region 字面量 `stage` 在分栏后仍是合法目标（split 子树里它还在），所以 `placeSurfaces` / `focusView` 不用重解析；这条由 `vendor` 的 `verify-views` 继续守着 |
| 21 | **机制断言用单测（`vp test`），活体门冻结在集成层**：`vp test` = vite-plus **内置的 vitest 4.1.10**（零新依赖，`vite-plus` 的依赖里就有）；单测覆盖纯函数与纯算术（区域树重写、`resolveSizes` 的分配、`isPresent`/`isStacked`、折叠与 `cachedSize`、`sideGeometry`/`splitRegionWith` 的子序、`sashSizes` 的两端 clamp、编排的"只填空缺"、持久化往返）；活体门**只留真页面能证明的事实**（产物过真 loader、VS Code 部件挂进/搬出 prac 区域并画出像素、扩展激活）；**新增机制断言只进单测**，要加活体门必须先写清"单测证明不了它" | **James 裁决 2026-09-15**（原话：*一直增加 verify 不是好思路，我们应该利用 test*）。判据：现在 ~130 条活体断言里大半是"在浏览器里给纯函数做算术题"——`sash 上界` 那类 bug 单测 5 行就能抓，而当时的门 23 项全绿。**代价（必须记住）**：单测看不见"模型对了、渲染器没跟上"的假绿（载荷漏 `mountViewInto` 那次全员绿）⇒ **每个能力在活体层至少保留一条渲染断言**，几何类多条并成**一条漂移检查**（`resolveSizes` 是 flexbox 的算术镜像，镜像要有人在真 CSS 上对一次） |
| 22 | **架构总纲：prac 是 CS/BS 两端结构 —— 以 DSH 为主干，VS Code 以插件方式集成**。① 看架构**先分 client / server 两端**（不是先分 DSH / VS Code：两个系统各自又都跨在线上）；② **主干是 DSH**，组合、状态、进程与生命周期都归它；**DSH 的扩展方式就是插件**（Cordis 插件树 + 动态包，同一地址空间、in-process 的 `inject`）——**“扩展宿主”只是 VS Code 架构里的概念，不能带到 DSH 上**（2026-09-16 三次更正，见下）；③ **VS Code 是主干上的一个插件**，两端各一半（server 半边拥有它的进程与能力，client 半边把 UI 贡献进 frame），**不是"被嵌进来的第三方 app 加一层接缝"**——bridge / part host / `prac-vscode-embed` 是**这个插件的内部实现**，不是两个对等系统之间的外交协定 | **James 裁决 2026-09-16**。原话：*不要以当前的代码实现为权威，听我说的，我是在纠正你积累的架构设计上的错误*。**它纠正的是设计，不是实现细节**——我此前把实现现状当成了设计权威（典型：我上一条用"VS Code 的词不能借"去否掉"DSH 有扩展宿主"，方向反了；实现只证明设计有没有落地，没有资格裁决设计）。**要收束的偏差**（已写进 `docs/architecture.md` §5）：① code server 的生命周期归主干（现在端口写死、无人启动，我此前还把它做成 A/B/C 选项——按设计**不存在选择**）；② 组装与权威在 server，页面是渲染目标（"页面是唯一的组装点"是我把实现现象写成了原则）；③ **集成单位没有被命名**（把 lib 与插件层混成了一层：lib 那一半是对的，缺的是“基于 lib 构建的 DSH 插件”这一层明确承担政策与集成）；④ 一个主干（现在两个服务端、双权威）。**2026-09-16 James 补充：三层各归其位** —— `vendor/vscode` = **引入的 VS Code 源码树 + 我们的 patch**；`vendor/vscode-embed` = 在它之上封装的 **lib**，**可利用、不绑定 prac**；**我们基于这个 lib 构建 DSH 插件**，把 VS Code 的能力与生态集成/带入 prac。⇒ 我此前把 lib 与插件层混为一谈（写成"接缝 = 插件内部实现"）**也错了**：lib 只给机制、不背政策，政策全在插件层（谁放哪 / 何时启动 / 哪个 view 用哪个 part / 能力怎么给 agent / code server 的生命周期）。**已澄清（James 2026-09-16）：没有 `vendor/vscode-lib` 这个包，那个 lib 就是 `vendor/vscode-embed`**——不改名。**2026-09-16 James 再纠一条**：*prac 中不只有基于 vscode 构建的一组插件，vscode 只是其中很重要的一部分* ⇒ **VS Code 集成族不是 prac 的主干内容**，它只是 prac 的一族插件；prac 自己还有 frame / 编排 / 角色 / 注意力 / 持久化，**尤其还有尚未落地的 agent 面（六件事）**，外加从 DSH 直接继承的能力族（`dsh-tools` / `dsh-skill*` / `dsh-goal` / `dsh-plan-mode` / `dsh-subagent*` / `dsh-workflow-worker-thread`，见 `packages/bundle/base/cordis.patch.yml`）。**教训**：我把"当前界面工作"误当成了"prac 的全部"，这是本文档与多轮讨论里反复出现的同一个错—— **2026-09-16 James 三条设计更正（同一决定内）**：① **不是“一个插件”**——*我们是基于 vendor/vscode-embed 开发**一组**插件*；② **VS Code 本身按 prac 的两端切成两半**：**code server = server 侧的 remote，提供 IDE 的基础功能**，**web = client 侧，提供 UI 组件**；③ **前后端通信层需要基于 DSH 的架构重新设计实现**——即**不能**把 VS Code 自己的传输（管理/扩展宿主 WS + HTTP 资源）从浏览器透传到 code server。⇒ 我的“透传代理 + 整包 workbench 嵌入”是**实现占位**，不是设计：浏览器现在绕过 DSH 直接跟 code server 讲 VS Code 的协议，而“UI 组件”这个单位完全没落地（client 侧嵌的是整个 workbench app，能力面也长在 client）。**这是尚未开始的设计工作，不是待修的 bug** |
| 23 | **机器状态按 XDG 分类：构建期与一次性的在仓库内（`.build/`），运行期状态在仓库外**。装好的扩展 → `$XDG_DATA_HOME/prac/code-server/extensions`；服务端状态（`workspaceStorage`/`globalStorage`/`History`/logs/`Machine`/`CachedProfilesData`）→ `$XDG_STATE_HOME/prac/code-server`；用户数据目录 → `$XDG_CONFIG_HOME/prac/code-server`（实测为空，留着是为了永不回退到 `~/.vscode-server-oss`）；缓存用系统默认 | **James 裁决 2026-09-17**（我问 `.build/run` 是否不合适，他答"应该遵循 XDG"）。依据：① 判据是"删掉它要付什么代价"——`.build/vscode` 是派生的、`scratch` 是一次性的，而那 9.5M（装好的扩展 + 各 `workspaceStorage`）删了就没了；把两者放进一个文档写着"可整份删"的根里，等于让那句话只对一半内容成立；② 与主干一致：DSH 的运行期状态也在家目录（`~/.dsh`，45M），不在任何 checkout 里；③ 分类有出处：扩展是**装好的文件**（data）、`workspaceStorage`/logs 是**重启后要留的状态**（state）、用户数据目录是**配置**——VS Code 自己在 Linux 上就把 `--user-data-dir` 放在 `$XDG_CONFIG_HOME`。**代价**：状态不再"看一眼就在仓库里"；闸门与启动命令都得从 `XDG_*` 派生（`verify-extension.mjs` 已改，`PRAC_RUN_DIR` 删除，`EXTENSIONS_DIR` 留作单点覆盖） |

### 被否决 / 已撤回的路线（"放弃了什么"）

| 原判断 | 为什么被否决 |
| --- | --- |
| workbench 当 shell、agent 当 part | 会得到**两个壳**（DSH 外壳 + workbench 各一套 sidebar/右栏） |
| 「frame 交给 grid 后可以删掉 `mountPartInto`/`movePartInto`」 | 方向错了：部件永远是被容纳的一方，host 机制保留 |
| 路线①：patch 经典 `Layout` | 要换掉的正是布局模型本身；路线① 只是跟 VS Code 的 grid 语义周旋 |
| 让 VS Code 的 grid 拥有 prac 的 frame（选项 a/c） | 会把关系倒过来；只借行为 |
| 「遮蔽 `root` 即可拥有拓扑」 | `ui-slots` 明文 DO NOT register；第二份注册会遮蔽整个 frame ⇒ 正规座位是 `shell.overlay`（list 槽） |
| `?folder=` 自建导航 | 那是 VS Code 自带 standalone bootstrap 读的，我们的入口是 `create()`，没有那层 |
| 「重载会打散 DSH 壳」 | 对照实验证明是**当时补丁损坏**的后果；带 `?folder=` 全新加载 / in-app `location.href='/'` / `openWorkspaceFolder` 三条路径 frame 全在 |
| 「`workspaceProvider.open()` 能打开文件夹」 | API 语义只是**构造 URL 开新窗口**；现明确返回 `false`（让调用方看见失败） |
| 「`create()` 的返回值是 workbench facade」 | 只返回 disposable；公开面是模块的 `commands` 命名空间 |
| 「`wsErrors: []` ⇒ WS 通了」 | 空错误可以意味着**什么都没发生**（当时 workbench 根本没启动） |
| 「派生路由（`codeServerRoutes()`）就修好了 segment 不一致」 | 只保证两侧一致地错；真正修法是给服务端 distro 的 `product.json` 盖章 |
| tsconfig `paths` 指向 checkout 作为覆盖开关 | 会把声明合并劈成两份（`keyof SlotMap` 有键、`register` 报 TS2769）⇒ 假错；机制正确的覆盖必须重定向**解析** |
| `dts: { only: true }` 出纯类型 | 不生效，还会覆盖 loader 产物 `client.js` ⇒ 用"类型再导出入口" |
| 「`intro` 会进产物」 | 被**静默丢弃**⇒ envelope 拼进 `banner`，并在 `bundle-client.mjs` 断言 |
| 「两个包到 `.build/` 的相对深度相同」 | 数 `../` 的想当然；失败形态是整片 404 ⇒ 改为逐级上溯"找" |
| `ctx.reflect.provide` 写法 | 文档拼写是 `ctx.provide`；行为不变 |
| 让补丁侧走全局 `__pracVsPartHost` / `__pracDeferVsParts` | 已被 S2 取代：走 `create()` 的 construction options（补丁本来就持有该服务） |
| 在机制里按 id 前缀判座位（`VS_VIEW_SOURCE`） | 机制不该认识来源词 ⇒ 按注册表成员判定 |

## 4. 开放问题

> 2026-09-15 的一轮问答把原先散着的一批收敛了：**已裁决的进决定表**（`2b` / `14`–`20`）或 09-15 note，这里只留**真的还没定**的。

### 与目标架构的差距（待收束）

> 2026-09-16：`docs/architecture.md` 改成**面向目标的设计**（James：*不建议再引用实现现状，我们是面向目标的架构设计*），"实现 vs 目标"的对照归这里（决定的出处见决定 22）。

| #   | 目标                                                                       | 现状                                                                                                           |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | **主干拥有 VS Code 的进程**（起 / 重启 / 关 / 给端口）                     | `prac-host-vscode/src/index.ts` 里 `CODE_SERVER = { host: "127.0.0.1", port: 3091 }` 写死，且没有任何地方启动它 |
| 2   | **主干（server）是组装与权威，页面是视图**                                 | 组合确实是主干的（profile / bundle patch / loader 行），但 **UI 组装、能力面的唯一实现**都在页面               |
| 3   | **VS Code 侧是*一组*插件**（基于 lib 构建，server 侧一族 + client 侧一族） | 只有两个包被当成"客户端机制 + host 策略"，其余座位各自成包，族的结构没有被表述                                 |
| 4   | **一个主干**                                                               | **两个服务端**（DSH 一个、code server 一个），且 code server 的 `--folder` 与 DSH 活动工作区不是同一个目录     |
| 5   | **两半之间的通信层基于 DSH 的架构重新设计**                                | 现在是**透传**：`/prac-vscode` 静态服务 + 把 VS Code 自己的 Management/ExtensionHost WS 原样转发到 code server |
| 6   | **client 侧提供 UI 组件、server 侧（code server）提供 IDE 基础能力**       | client 侧嵌的是**整个 workbench app**（自带完整 service 图、状态与协议），能力面也长在 client 侧               |

### 需要 James 裁

1. **理想形态是否确认**：`kernel / views / capabilities` 三层与"view 是单位"（决定 2b 已定，三层形态待确认）——方案与代价见 09-15 note。
2. **两套 server 统一**的路线：先"共存 + 共享 workspace"，还是直接"DSH 跑进 code server"（决定 18 只定了先换基座，已完成）。
3. **阶段二**（决策空间 / 以审决策为主界面）：**还不确定**——保持 `proposed`，不表态；C2 叫停的理由也仍待确认。
4. **高级形态（container / part）什么时候真的需要**：逐个 view 组合 vs"把整块 sidebar 原样搬来"。
5. **异步通道**：已定"先不做"，**形态未裁**（选项：最小标记 + 双向服务 / 完整异步线程 / 复用 chat 的留言模式）。

### 已排期、尚未做

6. **能力面（capabilities）**（含上下文入）：B1 已完成（工作记录 §A），它是 09-15 note 里紧随其后的那块——agent 读数/动作的 settled + provenance + 分页语义见该 note。
7. **frame 批次（进行中）**：`15` 已完成（堆叠 `verify:stack` 10/10、底栏 `verify:bottom` 11/11）、`16` 的 per-window 那半已完成（`verify:persistence` 16/16；per-workspace 那半未做）、`20` 已完成（`verify:split` 25/25：上下左右、可嵌套、竖 sash 可拖、形状持久，且**任何方向都不造空 region**）——门全在 prac 侧 `tests/gates/`。**还差** `17`（stage 的 tab，需要 VS Code 侧的 `editor(file)`；决定 17 说 tab 在 stage 内，是 frame 级标签页）。堆叠与底栏目前**没有**：拖拽排序、view 间 sash 调尺寸（靠 flex 均分）、底栏的开合入口（现在靠 `setCollapsed`，还没有 UI 按钮/快捷键）——记在案。
8. **扩展视图的"数据"**：`mountViewInto` 能让扩展贡献的视图出 pane、标题与像素，但 **tree view 的 body 是 `no data provider registered`**——`ViewPane.setVisible(true)` 不够，树数据要等视图基础设施/容器把裸 pane 认成"可见的视图"。两条候选路：把视图登记进 `IViewsService` 的可见性/容器模型，或改走"container 作为高级形态"（决定 2b/15 已允许）。
9. **扩展安装的正当路径**：等决定 19（VS Code terminal 提供 `VSCODE_IPC_HOOK_CLI`）落地后，用 `server-cli --install-extension` 正规安装并重跑第六门；在那之前不装用户扩展。
10. **sidebar / panel / statusbar 的映射**：目前只落了 sidebar + 对话 + 编辑器 + 环境条/调出面；以及补 stub 掉的 layout 语义（显隐 / zen / centered / floating / 多窗口）。

### 仍然开放（工程与生态）

11. **Step B 第二部分**：view id 仍是 **6 处**字面量、`/prac-vscode` 仍是 Node/浏览器**两处**；**共享常量模块的落点与依赖方向仍未定**（"契约写多遍"的根因）。
12. **内建扩展编译**：`npm run build-fast-extensions` 被 `extensions/ipynb` 的 typecheck 挡住（现 **12/106**）。决定 18 的验收已用**市场扩展**（GitLens）走通，所以它不再是"生态是否可用"的前提；但它仍挡着**内建**扩展（git / search / emmet 等）在服务端可用。
13. **agent 能力面**目前**没有任何实体**（排期见 6）；能力清单与 settled / provenance / 分页语义见 09-15 note。
14. **两处 native / 可选缺口**（既有、非阻塞）：`@vscode/fs-copyfile` 抛 `Cannot find module '../build/Debug/vscode_fs.node'`（未捕获，宿主照样起）；`spdlog` 降级（server 目标上同样出现）；`vsda` 缺失；页面两个 404 是客户端可选模块（`@vscode/vscode-languagedetection`、`vscode-regexp-languagedetection`）。
15. **机制正确的 checkout 覆盖开关**（重定向解析而非文件路径）：未做；`dsh-types --compare` 已覆盖"类型是否漂移"。
16. **进度已提交（2026-09-15）**：分支 `feat/vscode-dsh-integration`，`wip:` 提交（含签名），tag `wip/vscode-dsh-2026-09-15`。**提交 ≠ 成果已定**——靠 James 判断的内容仍要审阅；后续进度按同样方式（feature 分支 + `wip`）提交。

## Related

- [2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)：概念边界与命名的决定 + 执行（Step A/B、命名收束、lib 抽出）。
- [../proposed/2026-09-15-vscode-capabilities-into-prac.md](../proposed/2026-09-15-vscode-capabilities-into-prac.md)：把能力拆散带入 prac 的理想形态与第一步方案。
- [../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md](../resolved/2026-09-08-prac-positioning-and-dev-workflow-model.md)：prac 的定位与开发工作流模型。
