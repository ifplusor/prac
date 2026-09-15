---
status: in-progress
---

# Agent Note: prac 的界面形态 —— VS Code × DSH 融合

> 这是这项工作的 **umbrella**：主线定义、需求约束、现在的形态、决定（含被否决的路线）、里程碑与依据、已核实事实、踩坑、开放问题。
> 步骤 note：[2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)（概念边界与命名，实现已完成，待签字）；[../proposed/2026-09-15-vscode-capabilities-into-prac.md](../proposed/2026-09-15-vscode-capabilities-into-prac.md)（把能力拆散带入 prac，方案待裁）。
> 口径（**决定 21 删减后**）：**vendor 侧集成门**写作 **14/14 · 25/25 · 9/9 · 1/1 · 7/7 · 9/9**（layout · views · focus · regions · view · file）；**prac 侧活体门**写作 `verify:stack 6/6 · verify:bottom 6/6 · verify:persistence 6/6 · verify:split 11/11`；所有 part 计数一律 **8/8**；**单测**写作 `pnpm test`（48 条：`ui-layout` 40 + `web-app` 8，~300ms）。活体断言总数 **142 → 85**（prac 62 → 29，vendor 80 → 56）：删掉的都是被单测覆盖的纯机制事实，几何类并成每个能力**一条漂移检查**。第六门 `verify-extension` 是**条件门**：装了扩展才跑（5 项），没装时明确 `SKIPPED`——SKIP 不是通过。旧 note 里的顺序混用与 "7 个 part" 已纠正；上面的数字是**当下**口径，历史里程碑行里的旧数字是当时的事实，不改写。

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

## 3. 现在的形态（2026-09-15）

```
DSH web 页
├── prac frame（prac-client-ui-layout）：区域树 / sash / 座位 / 视图目录 / recall —— prac 自己的词
│     ├── dsh:*     视图：DSH 插件注册进槽（对话、导航…）
│     └── vscode:*  座位：把 VS Code 的 part 挂进某个 region
├── prac-client-vscode-host（prac 的行）：工作区解析 + view→part 映射 + pracVscode 服务
│     └── prac-vscode-embed/client（lib，prac-free、DSH-free）：boot 一次 / partHost / 主题类 / 命令面
│           └── 补丁后的 Code - OSS（vendor/vscode）：EmbeddedWorkbench 把 part 交给外部 host
└── prac-host-vscode（prac 的行）：/prac-vscode 路由 + /oss-<segment> 代理 → code server :3091
```

包：`packages/{bundle/web-app, client/{ui-layout, vscode-host, ui-vscode-editor, ui-vscode-explorer}, host/vscode}` + `vendor/{vscode, vscode-embed}`；profile `prac-dev` = 三 bundle（`dsh-base` / `dsh-web-app` / `prac-web-app`）+ 六 link。

**关键事实（实测）**：

- 一页 `create()` 一次；part 是**单实例** ⇒ 只能 `movePartInto` 搬、不能重建；隐藏 region 必须留 host（`verify-focus` 的 `partInOneHost` 是这条的化石）。
- 扩展宿主、文件/配置/存储随 workbench 的 bootstrap 起来；`workspace.id` 在 `create()` 时定死（IndexedDB key + profile 选择）⇒ 启动必须等"工作区已知"，且**不能先建后纠**。
- 补丁只动上游两个文件（`web.factory.ts`、`web.main.ts`，**74 行 delta-only**）；载荷走 `overlay/`，由构建放进 checkout（每次构建先 `git clean -fd`，保证 checkout 不是第二份真相）。
- DSH 侧：prac 的包作为**行**由 `prac-web-app` 的 patch `insert`；**loader 行 id 取的是产物 id**（`clientPack(id)`），包的 `name` 只用于诊断。
- 跨插件共享的页面级状态只有一处：`globalThis.__vscodeEmbed`（boot 守卫、boot 元素、命令面、失败原因、part→元素表）。
- **空 region 不渲染**（`isPresent`：非 flex 且没有可见 view ⇒ 不在 DOM 里）⇒ 新增区域可以"零成本地存在"，填了才出现；这也让底栏这种"默认收起"的东西不需要单独的状态。
- 构建期契约只有一处：`vendor/vscode/overlay/bridge.ts`（`EMBED_BRIDGE` / `PART_HOST_ATTR` / `PartHostFace` / `EmbedBridge`），两侧编译同一份原件。

## 4. 决定

> **编号 = 引用句柄**（对话与其它 note 直接引"决定 14"），所以**只追加、不复用、不重排**；下面的主题导航只做索引。
> **主题导航**：与上游/补丁 `3 4 5 6` ｜ 边界与分层 `1 2 2b 7 8 9 10` ｜ 区域与布局 `14 15 16 20` ｜ 编辑器与文件 `17` ｜ 工作区与状态 `13` ｜ 生态与能力 `18 19` ｜ 工程 `11 12`
> **当前队列（建议顺序，未裁）**：~~`14`~~、~~**B1**~~、~~`18`~~（均已完成，见 §5）→ frame 批次 `15 16 17 20` → 能力面（含上下文入）

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
| 18 | **扩展基座换成完整 `server` 目标**：`build.mjs` 增加 `--target server`（**必须带 `--nls`**）的构建，host 与 code server 指向它；**验收判据 = 一个 Tier 2 扩展真的激活，且它的 UI 贡献出现在 prac 的 view 目录 / 区域里** | **James 裁决 2026-09-15**（先换基座、再验证生态）。已知坑（都在踩坑表里）：`--out` 必须相对路径；数据目录要重定向；`product.json` 要盖章；`server-cli --install-extension` 被环境守卫挡住 ⇒ 装扩展要另有路径 |
| 19 | **terminal 用 VS Code 的**（完整 `server` 目标自带 PTY + shell integration + 扩展 API），它只是底栏里的一个 view；**agent 执行命令走 DSH 自己的 exec**，不与人那条终端共用（代价：agent 看不到人终端的输出，除非日后做桥） | **James 裁决 2026-09-15**；作废旧计划"纯 web 无 PTY ⇒ PTY 放 DSH host"（决定 18 换基座后其前提消失） |
| 20 | **`stage` 支持任意方向分栏**（上下左右、可嵌套） | **James 裁决 2026-09-15**（细化决定 15：stage 不止左右分）。**2026-09-15 已完成**：模型层的两轴早就能吃（`node.dir === "row" ? w : h` + 递归 `visit`），补的是门面与动作——① 面从 `split(regionId, dir?)` 改成 **`splitView(viewId, side)`**（`Side = left/right/up/down`）：**view 是主语**，机制为新区域**为这个 view** 而建，所以**任何方向都造不出空 region**（决定 15「分栏必带视图」）；`Side` 一个词同时决定轴与插入顺序（left/up 在前，right/down 在后），没有"只给轴不给侧"的含糊。② `splitRegionWith`（`model.ts`）纯函数：新区域一律 flex——源是 flex 时两半均分，源是固定尺寸时源保持尺寸、新区域吃 split 自己的余量。③ 用户动作在 recall 面的每个 view 行上：←↑↓→ 四个按钮（区域行的旧"分栏"按钮已删，它造的正是空 region）。④ 门 `tests/gates/verify-split.mjs` **25/25**：右/左两个相反方向都测（顺序分支不能只测一侧）、down 形成**嵌套** column split、竖 sash 真鼠标拖拽改尺寸、reload 后形状与尺寸都在。**注意力不必改**：编排的目标 region 字面量 `stage` 在分栏后仍是合法目标（split 子树里它还在），所以 `placeSurfaces` / `focusView` 不用重解析；这条由 `vendor` 的 `verify-views` 继续守着 |

| 21 | **机制断言用单测（`vp test`），活体门冻结在集成层**：`vp test` = vite-plus **内置的 vitest 4.1.10**（零新依赖，`vite-plus` 的依赖里就有）；单测覆盖纯函数与纯算术（区域树重写、`resolveSizes` 的分配、`isPresent`/`isStacked`、折叠与 `cachedSize`、`sideGeometry`/`splitRegionWith` 的子序、`sashSizes` 的两端 clamp、编排的"只填空缺"、持久化往返）；活体门**只留真页面能证明的事实**（产物过真 loader、VS Code 部件挂进/搬出 prac 区域并画出像素、扩展激活）；**新增机制断言只进单测**，要加活体门必须先写清"单测证明不了它" | **James 裁决 2026-09-15**（原话：*一直增加 verify 不是好思路，我们应该利用 test*）。判据：现在 ~130 条活体断言里大半是"在浏览器里给纯函数做算术题"——`sash 上界` 那类 bug 单测 5 行就能抓，而当时的门 23 项全绿。**代价（必须记住）**：单测看不见"模型对了、渲染器没跟上"的假绿（载荷漏 `mountViewInto` 那次全员绿）⇒ **每个能力在活体层至少保留一条渲染断言**，几何类多条并成**一条漂移检查**（`resolveSizes` 是 flexbox 的算术镜像，镜像要有人在真 CSS 上对一次） |

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

## 5. 里程碑与依据

| 日期 | 做了什么 | 依据（判据 / 证据） |
| --- | --- | --- |
| — | A 路线跑通：own 一个 checkout 构建，自建入口调 `create()` | 干净重建 **~3–4 分钟**（`npm install --ignore-scripts` 跳过 native/playwright/copilot 脚本）；`.build/` gitignored |
| 2026-09-11 | `--target server` 构建 + 启动 | **51MB**；**带 `--nls` 才成功**；日志 `Server bound to 127.0.0.1:3090` / `Extension host agent started.` |
| 2026-09-11 | `--target server-web` 构建 | **313MB / 20 bundles**；能起、能服务客户端 HTML |
| 2026-09-11 | server-web 端到端 | 服务端 `Starting extension host process` / `Launched Extension Host Process` |
| 2026-09-11 | 客户端关口：我们的 workbench 能当 self-built server 的客户端 | 页面真的发出 `GET :3091/oss-<hash>/vscode-remote-resource`；唯一失败原因是 CORS（`:3082` vs `:3091`） |
| 2026-09-12 | 同源代理（HTTP + WS 升级）落地 | 页面两条同源 WS 零 1006；服务端 `New connection established`（Management）+ `Launched Extension Host Process`（ExtensionHost） |
| 2026-09-12 | HTTP 代理 404 修复 + 直连/代理对齐 | direct `:3091` 与 proxy `:3084` 同路径都 **200 / 441B**（body 即工作区真实 `package.json`） |
| 2026-09-12 | `stampServerCommit()`（两侧读同一份 commit） | 幂等复跑输出 `server: product.json already stamped (645f29cc31)` |
| 2026-09-12 | `verify-views` Escape 修复 | `open → Escape → closed`；面板关着时路径 `["window-capture","document-capture"]`、开着时只剩 `["window-capture"]` |
| 2026-09-12 | `codeServerPath()` 不再必然抛错 + 失败隔离 | 失败返回 `undefined` + warn、代理整段 `try/catch`；最坏降级为"没有代理" |
| 2026-09-12 | 工作区来自**会话**（删 `PRAC_WORKSPACE_FOLDER`） | 实测解到 `folders: ["vscode-remote://…/dsh-dev"]`（非硬编码），explorer 列出 `apps/ benchmarks/ docs/ native/` |
| 2026-09-12 | `folderUri` revive 修复（空工作区） | `workspaceInfo()` 从 `folders: []` 变成真实 folder；闸门全绿 |
| 2026-09-12 | 第 3 步 `workspaceProvider` 达成 | 打开 `…/prac-dev/package.json` → `.view-lines` = **26 行正文**、`couldNotOpen: false`、**WS 1006 = 0** |
| 2026-09-12 | sidebar part 挂进 prac region | `listViews()` 出现 `vscode:sidebar`；place 到 `left` 后渲染出 `No Folder Opened` / Outline / Timeline 三个 pane header |
| 2026-09-12 | 包结构重组（目录去 `prac-`、workspace 改 `packages/*/*` + `vendor/*`、profile 重指） | 三包 `check`/`check:client` 全绿；DSH 从新布局启动；四闸门全绿 |
| 2026-09-13 | `vendor/vscode` 纯化为 vendor（host 半边移出到 `prac-host-*`） | vendor 无 `main`/无 `dsh`、`exports` 只有 `./package.json`；`/prac-workbench/vs/workbench/workbench.web.main.internal.js` **200 且 37,275,589 字节**；八包 `check` 全绿 |
| 2026-09-13 | 拆包 + 命名对齐（八包） | 八包 `check` 全绿、五份产物 loader 接受、四闸门全绿；删掉 `prac-layout` 遗留的 `dsh.bundle.patch`（它永远不会被读） |
| 2026-09-13 | HMR 临时关闭后恢复 | profile patch 恢复 `[]` + 注释；`verify-regions` 1/1 |
| 2026-09-13 | **S2**：补丁交互面走 `create()` 的 construction options | 产物含 `pracVsBridge` **1 处**、`__pracVsPartHost`/`__pracDeferVsParts` **0 处**；顺带删掉 **50ms 轮询**；默认路径 `vscode:smoke` exit 0、part 全挂载、`errorCount: 0`；staged 契约与仓库原件 `diff -q` 相同 |
| 2026-09-13 | 通道升级：`__pracVscodeHost` → DSH service | 产物 `__pracVscodeHost` **0 处**、两个座位各含 `pracVsHost` **2 处**；四闸门全绿 |
| 2026-09-13 | `isSeatView` 改按**注册表成员**判定 | 删 `VS_VIEW_SOURCE`/`PRAC_VIEW_SOURCE`；`readSeatViewIds(ctx.slots)` 读 `slots.entries("prac.view")`；`verify-layout` 24/24 |
| 2026-09-13 | 组合实验：座位可缺、机制不可缺 | 只留一个座位 → `regions: 3`、`hosts: 1`、无 boot 失败；抽掉机制 → `2 entries did not activate` + `pending (waiting for service: pracVsHost)`、`regions: 0` |
| 2026-09-13 | 服务写法改文档拼写 `ctx.provide` | 产物 `reflect.provide` **0 处**；四闸门复跑全绿（**无需重启 DSH**） |
| 2026-09-13 | **Step 0**：DSH 类型改用 npm 发布包 | catalog 加 **9 个精确 pin**（`@deepseek-ai/cordis@4.0.2`、`dsh-client-ui-*` / `dsh-api-*-controller` / `dsh-host-webserver` `@0.1.5-rc.1`）；八包 check 全绿 |
| 2026-09-13 | `dsh-types --compare` 漂移比较器 | 逐字节比对安装副本与 checkout；**实测 9 个包全部一致** |
| 2026-09-13 | 依赖声明收束（只有 cordis 是 peer） | 6 包 `@deepseek-ai/cordis: ^4.0.2` peer、8 个 DSH 包 devDep；全仓 `@deepseek-ai/*` import 都是 `import type`；client bundle 只 `require("react")` |
| 2026-09-13 | React 真类型（`react ^18.2.0` + `@types/react ~18.3.1` devDep） | 立刻抓到真 bug（座位面 `() => unknown` → `() => ReactElement \| null`）；产物 `require("react")` 恰好 1 处、无内联 |
| 2026-09-13 | **Step A**：拆 `ui-layout`（1591 行单文件 → 8 模块） | `index`166 / `services`219 / `frame`523 / `model`370 / `contract`243 / `catalogue`150 / `store`104 / `theme`65；`.d.ts` 一个不剩；闸门全绿 |
| 2026-09-13 | **Step B 第一部分**：发布 prac 的 client 类型 | `dist/client.d.mts`（ui-layout **8.4 kB** / vscode-host **37.9 kB**）+ `dist/client.mjs` **0 字节**空壳；13 个构建任务 |
| 2026-09-15 | **命名收束**（`vs` 退役、`workbench` 退回 vendor、载荷去 prac 名） | 三条 `grep` 判据全 **0**；九包 `check`、五份产物、四闸门、独立页 smoke 8/8 + `errorCount: 0` |
| 2026-09-15 | 抽出 `vendor/vscode-embed`（prac-free lib），prac 两行变薄 | 同上；staged 载荷与 `overlay/` 逐字节一致 |
| 2026-09-15 | **决定 15 后半落地（常驻底栏）**：默认树包一层 `column`（`root`）＝ 上面那行（`top`）＋ `BOTTOM_REGION`（`bottom`，240，stack，**空**）；**空 region 不渲染**（`isPresent`）⇒ 默认布局零成本、region 列表仍是 `left,stage,right`。填了视图就出现在底部、占满宽度、上方那行让出高度；折叠后高度归零、空间还回 | 新 prac 侧门 `verify:bottom` **11/11**（空则不在 / 填了上屏并像素质 / 贴底且满宽 / 240px / 上方让位 / 折叠归零 / 还原）；vendor 五门与 smoke 全部未动 |
| 2026-09-15 | **决定 15 前半落地（侧栏堆叠）**：`RegionNode.stack`（prac 的模型）、默认树把 `left`/`right` 标成 stack、frame 在**同一 region 有 ≥2 个可见 view 时**逐个渲染（header = view id 尾段 + 折叠开关）、`pracLayout.setViewCollapsed` 记折叠态。**vendor 一个字节没碰** | `tests/gates/verify-stack.mjs`（第七门，prac 侧）**10/10**：单 view 时**像素不变/无 header**（默认布局行为保持）、两个 view 堆叠且都有 body、折叠后 header 在/body 消失/邻居变大、点 header 也能折；原六门与 smoke 全绿 |
| 2026-09-15 | **决定 18 落地（扩展基座换 `server` + Tier 2 证明）**：`build.mjs` 增加 `--target server`（`out-server`，带 `--nls`），并把 **checkout 根**、`out-server`、`out-server-web` 三份 `product.json` 都盖章；服务端改用 `out-server/server-main.js`；装 **GitLens**（`eamodio.gitlens-2026.9.92030`，手工解包进 `--extensions-dir`；**验收后按 James 裁决撤装**，等决定 19 给出正当安装路径） | 新第六门 `verify-extension` **5/5**：`gitlens.views.welcome` 挂进 prac 后有 pane、标题 `Welcome`、40 种颜色、可释放 ⇒ **扩展激活**（描述符只有激活后才注册）。`/oss-645f29cc…/version` 200 而 `oss-dev` 404（两侧 segment 一致）；原五门 **24/24 · 33/33 · 12/12 · 1/1 · 7/7** 不变；独立页 smoke 8/8 |
| 2026-09-15 | **B1 落地（单 view 宿主）**：契约加 `mountViewInto`/`releaseView`，载荷用 `ViewPane.render()` 把单个 view 造成自带 pane 挂进外部元素（`getViewDescriptorById` 拿描述符，镜像 `ViewPaneContainer.createView` 的参数），lib 加 `view(viewId)` 句柄，explorer 座位改挂 `workbench.explorer.fileView` | 新第五门 `verify-view` **7/7**（自带 `.pane` + 标题 `dsh-dev` + 302 种颜色 + **页面无 sidebar part** + 跨 region 搬移时**释放后重建成功**）；原四闸门 **24/24 · 33/33 · 12/12 · 1/1** 不变；独立页 smoke 8/8 + `errorCount: 0` |
| 2026-09-15 | **决定 14 落地**：`selectPanel` 把选中视图放进**它自己的** region（无家则进中心），让出中心的视图停到编排绑定的 **track**；对话按普通 view 参与注意力（聚焦谁，谁进 stage，另一个停 right） | 八包 `check` + root `vp check .` 绿；四闸门 **24/24 · 33/33 · 12/12 · 1/1**（两条断言随决策更新：`promotedTrackClosed` → `promotedChatParksInTrack`，verify-views 改为读对话的放置而不是推断轨道消失）；独立页 smoke 8/8 + `errorCount: 0` |
| 2026-09-15 | **决定 16 落地（per-window 持久化）**：`ui-layout` 的 store 换成 DSH `client-store` 的 `createSnapshotStore(..., { persist: { name: "prac-layout/v1" } })` 薄适配；`dsh-client-store` 声明成**平台词**（`scripts/pack-client.ts` 镜像 `PLATFORM_MODULES`，`bundle-client.mjs` 的白名单＝那张表）；`arrange()` 的默认放置改成**只填空缺** | 新 prac 侧门 `verify:persistence` **16/16**；对照实验：去掉 `arrange()` 的 `continue` ⇒ 5 项立刻变红（门真的在断言这件事）；产物 +0.8 kB（内联 zustand/immer 要 ~15 kB） |
| 2026-09-15 | **决定 20 落地（任意方向分栏，分栏必带视图）**：面从 `split(regionId, dir?)` 改成 **`splitView(viewId, side)`**（`Side = left/right/up/down` 一个词同时定轴与插入顺序）；`model.ts` 的 `splitRegionWith` 纯函数（新区域一律 flex）；recall 面每个 view 行加 ←↑↓→ 四个按钮，删掉造空区域的 region 级"分栏" | 新 prac 侧门 `verify:split` **25/25**（左右两个相反方向都测、down 形成嵌套 column、竖 sash 真鼠标拖拽改尺寸、reload 后形状与尺寸复原）；prac 其余三门 10/10 · 11/11 · 16/16 不变；vendor 门 **25/25 · 35/35 · 12/12 · 1/1 · 7/7**（layout +1 断言、views 第 7 节按新语义改写并 +1；`verify-extension` 仍 SKIP）＋ smoke 8/8 + `errorCount: 0`；`vp run -r check` 与 root `vp check .` 绿 |
| 2026-09-15 | **决定 21 第一步（把纯逻辑提出来并建单测）**：`frame.ts` 里的 `sashSizes`（拖拽数学）、`subtreeMin`（预算里"其它子树的最小值"）与内联的渲染判据 `stacked` 全部上移进 `model.ts`（新增导出 `isStacked(state, node)`），`frame.ts` 只负责渲染；`ui-layout` 加 `"test": "vp test run"`，根 `test` 改成 `vp run -r test --passWithNoTests`（没有测试的包默认 exit 1，必须带这个 flag） | 新单测 `ui-layout/src/client/model.spec.ts` **33 条 / 6ms**：默认树与 region 列表、放置与 `visibleViews` 顺序、`isStacked` 的"单 view 裸渲染"、`isPresent` 四种情形、`resolveSizes`（固定轨、空固定轨**不进 box map**、底栏那一层、折叠为 0、flex 均分）、`cachedSize` 往返与**按身份 no-op**、`sashSizes` 的 flex\|flex / 固定\|固定 / **两端 clamp** / **budget 上界**、`Side` 四向 → 轴+子序、`splitRegionWith` 的"只多一个 region"与嵌套、未知 region 按身份 no-op；产物未含 spec（`grep` 判据）、`check:client` 仍 `ok`；全部门与 smoke 未动 |
| 2026-09-15 | **决定 21 第二步（编排策略提出来 + 目录表单测）**：`web-app` 的放置策略（`DEFAULT_PLACEMENTS`/`ROLES`/`placeSurfaces`/`focusView`/`arrange` + 相关常量与 `Surface` 类型）从 745 行的插件体搬进 **`src/client/arrangement.ts`**（插件体只留 UI：焦点条、recall 面、键位），`index.ts` 改从它导入；`ui-layout` 新增 `catalogue.spec.ts`（`viewSource`、`catalogueViewIds` 的"两源 join + 排序稳定"、`readSeatViewIds` 的**成员判定按注册表而非前缀**） | `arrangement.spec.ts` **8 条**（注意力四向落位、聚焦时对话停 track、`arrange` 的**只填空缺**、新视图仍会补位、`bindRoles`/`bindTrack` 的参数）；`catalogue.spec.ts` **7 条**；全 `pnpm test` **48 条 / ~300ms**；`check:client` 两份产物仍 `ok`；prac 四门与 vendor 五门 + smoke 全绿 |
| 2026-09-15 | **一条"故意不搬进单测"的判断**：DSH store 引擎的持久化往返（写 `localStorage` + 构造时 rehydrate）**留在活体层**（`verify:persistence`），不为它装 `zustand`/`immer` devDep | 理由两条：①它验的是**平台库的集成**，不是我们的逻辑（我们的适配器只有 15 行）；②现在"依赖没装"恰好是一个**响亮的失败**——谁把 `@deepseek-ai/dsh-client-store` 从 `external` 里拿掉，构建会立刻报模块解析失败；装了这两个包之后，那份引擎会被**静默内联**（产物里多一份状态引擎，`check:client` 也抓不到）。⇒ 决定 21 的"每个能力留一条活体断言"在这里正好落到持久化上 |
| 2026-09-15 | **决定 17 前半之二（app 自己打开的文件要报到）**：bridge 再加 `listOpenFiles()` / `onDidChangeOpenFiles(listener)`——**唯一能从 app 内部知道"现在开着哪些文件"**的来源（explorer 点击、命令、跳转都走 `IEditorService`）。事件不是现成的：`onDidActiveEditorChange`/`onDidCloseEditor` 都可能意味着集合变了，所以在载荷里**比集合**（变了才通知，dedupe 掉"只是激活"）；刻意不用 `onDidVisibleEditorsChange`——editor part 可能永远不 mount，"visible" 不是我们能依赖的。**列表按"能不能渲染成文本面"过滤**（`ITextModelService.canHandleResource`）：getting-started 页（`walkThrough:`）是有 resource 但没有文本模型的编辑器输入，实测它在未过滤时排在最前——退役 editor part 后它就会变成一个挂不上的假 view。embed 客户端加 `file(resource)` 组件工厂（卸载即 `releaseFile`）与两个透传 | `verify-file` **9/9**：多了两条——`openUntitled()` 之后列表恰好 +1 且事件只来一次（实测 `before: []`、`after: ["untitled:Untitled-1"]`）；其余八项不变 |
| 2026-09-15 | **决定 17 前半（vendor 侧的 file 级宿主）**：bridge 的 `PartHostFace` 加 `mountFileInto(resource, element)` / `releaseFile(resource)`——**单位是文件**（谁开着哪些文件、怎么分组、tab 条长什么样，都是 prac 的事）；载荷里的实现镜像工作台自己的造法：`CodeEditorWidget`（`TextCodeEditor.createEditorControl` 用的就是它）+ `ITextModelService.createModelReference(uri)`（工作台自己的文本模型 ⇒ 语言特性/marker/undo/save 都是真的），只多一个 `automaticLayout`（宿主 region 会 resize，没有别的东西会通知 widget 重排）。**一个资源一个编辑面**：重复 mount 是同一实例换宿主（一个文件一个模型，第二个编辑器就是同一份文本的第二视图），`releaseFile` 只释放引用（模型留给别人） | 新门 `vendor/vscode/scripts/verify-file.mjs` **7/7**：两个文件各自上屏且渲染出**该文件真实文本**（期望值由 gate 自己从磁盘读同一个文件算出，因为 app 的工作区不是 prac 仓——见下）、都有像素质、同文件第三次 mount 得到同一实例（第一个宿主被搬空）、release 后同一文件能再 mount、无 mount 报错；其余六门 + smoke 8/8 未动。**诚实的缺口**（决定 17 的下一步要补）：面包屑/peek/diff/自定义编辑器/热退出这些挂在 `EditorInput`+`EditorPane` 上的贡献**没有**；tab 条与分组按决定 17 归 prac，所以 frame 级 tab 还没做 |
| 2026-09-15 | **一个实测到的运行事实（工作区归属）**：app 的工作区是 **DSH 的活动工作区**——本次是 `vscode-remote://127.0.0.1:3084/Volumes/Dev/deepseek-harness/dsh-dev`，而不是 code server 启动时给的那个目录（`/Volumes/Dev/prac/prac-dev`） | 与决定 13「IDE 侧随 DSH 工作区」一致（`prac-client-vscode-host` 的 `activeWorkspace(ctx)` 读 DSH 注册表），但**两处路径不一致**：code server 的 `--folder` 只影响它自己的 CLI / 终端 cwd（决定 19 要确认这算不算 bug）。也是 `verify-file` 不能写死文件名的原因 |
| 2026-09-15 | **决定 21 第三步（按清单删减活体断言）**：把活体层里"纯机制的算术题"删掉——prac 侧 `verify:stack` 10→**6**（`isStacked` 的判定、`visibleViews` 顺序进单测）、`verify:bottom` 11→**6**（`isPresent`/`resolveSizes`/`cachedSize` 进单测，几何四条并成一条）、`verify:persistence` 16→**6**（`arrange` 只填空缺与"改动生效"进单测；**存活断言一律改成绝对式**，相对式会在"改动其实没发生"时真空通过）、`verify:split` 25→**11**；vendor 侧 `verify-layout` 25→**14**（模型侧放置/几何/clamp 进单测，6 条像素并成 3 条）、`verify-views` 35→**25**（只删纯模型断言——它本就是 recall 面的 UI 契约）、`verify-focus` 12→**9**（摆放规则进单测）；`verify-regions` 1、`verify-view` 7、smoke、extension 未动 | 活体断言 **142 → 85**（prac 62→29、vendor 80→56），单测 48 条；所有门重跑全绿：prac 6/6 · 6/6 · 6/6 · 11/11，vendor 14/14 · 25/25 · 9/9 · 1/1 · 7/7，smoke 8/8 + `errorCount: 0`；`vp run -r check` 与 root `vp check .` 绿。**留下的是三类**：产物过真 loader、VS Code 部件挂进/搬出 prac 区域并画出像素、几何与算术镜像的**漂移检查** |

## 6. 已核实事实

### DSH 侧

- **每个 client 插件各自打包、各自内联** ⇒ 模块级单例**不共享**；跨插件共享一个面必须走模块图之外的载体（Cordis service；补丁侧无可避免时用页面级全局）。
- **loader 行 id = 产物 id**（`clientPack(id)`），包的 `name` 只用于诊断。
- **依赖缺失的 fiber 保持 pending** ⇒ 坏组合表现为"挂起"而不是"渲染空白"（实测报 `pending (waiting for service: …)`）。
- 固定三轨尺寸；`main` 是 **keyed 单占位**（`entryKey: panelId ?? 'conversation'`）⇒ 对话与编辑器**不能同屏**；`slot:rightbar` 默认隐藏。
- `root` 槽明文 **DO NOT register**；`shell.overlay` 是自建浮动面的正规座位（list 槽、加性、点击穿透）。
- client 插件的 `require` 解析**注册过的 bundle id + 一张静态平台表**（见下），其余必须自包含；`exports` 里导 `./src/*` 只对**构建期**（打包器/TS）有效。
- **loader 的模块表有一张固定的平台词表**（九词）：`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `@deepseek-ai/cordis` / `@deepseek-ai/dsh-client-store` / `@deepseek-ai/dsh-client-ui-slots` / `…-ui-primitives` / `…-ui-dockkit`。真源是上游 `packages/client/web/src/platform.ts`（`packages/client/web/src/seed.ts` 按它 seed 成唯一实例），上游自己的打包器也把这张表当 external 基线（`packages/client/tsdown.client.ts`）⇒ **跨插件共享一个实现的正规路径是 require 表里的词**（`dsh-client-store` 就是这样一个词），而不是各插件各自内联一份。prac 侧镜像在 `scripts/pack-client.ts` 的 `PLATFORM_MODULES`：它既是 `clientPack(..., { external })` 的合法取值，也是 `bundle-client.mjs` 的 `--allow` 白名单（2026-09-15 实测：把 `dsh-client-store` 声明成 external 后，产物只 +0.8 kB——内联 zustand/immer 要多 ~15 kB 且是第二份状态引擎）。
- `dsh-web-app` 自带 `client-hmr`，有已知的 `duplicate factory registration` 症状。
- 客户端产物是 **lazy-CJS**：`window.__ModuleLoader__.load({id, factory})`（原生 ESM 会 `Unexpected token 'export'`）。

### VS Code 侧

- **不可作可消费依赖**：根 `package.json` `"private": true`、无 `"exports"`、`"main": "./out/main.js"`；构建工具链在根 devDependencies（**104 个**）＋独立子包 `build/`（**59 devDeps**，pnpm 不装）⇒ 只能 own 一个 checkout 构建。
- `create()` 一页一次；`workspace.id` 在 `create()` 时定死（IndexedDB key + profile 选择）⇒ **一个窗口一个工作区**，切换只能导航（即重载）。
- 扩展宿主按 `reconnectionToken` 索引（**每客户端连接一个**）⇒ 多窗口同一工作区天然支持；server 要保的是"工作区存在性 + 扩展宿主/会话"（`reconnection-grace-time` 默认 **3 小时**）。
- 前端 UI 状态（区域尺寸/调出面板/展开项）按工作区 id 存在**浏览器** IndexedDB，跨连接存活。
- `createWorkbench`（`IBrowserMainWorkbench = { startup, onWillShutdown, onDidShutdown }`）是上游给"换一个 app"留的缝（`protected` 可覆写）；上游自己的第二个 app（`src/vs/sessions/`）用的也是它，并另覆写 `createWorkspaceConfigAndStorageServices`。
- `IWorkbenchLayoutService` 约 **51 个成员**；sessions 的 `Workbench` 模板 **2976 行**。
- **part 由服务 eager 造**（`IPaneCompositePartService` / `ITitleService` / `IStatusbarService` / `EditorParts`），`Part` 构造时自注册进 layout service（`part.ts:61`）；part 只在被 `create(parent)` 时才进 DOM。
- `ViewPaneContainer.create(parent)` 接受**任意外部 parent**（`new PaneView(parent, options)`）。
- workbench bundle **~37MB 必须同源**服务（worker 跨域会被浏览器挡）。
- `Part.create` 与容器无关；但 part 容器的区分性 class **是承重的**（CSS 命中不到 ⇒ 内部 grid 高度塌成 0）。经典 workbench 与 sessions 都靠 `SerializableGrid` 给 part 定位。

### 扩展基座（`server` 目标，2026-09-15 起）

- 构建产出 **两个目标**：`out-vscode-web`（web bundle）与 `out-server`（标准 server 目标，**扩展基座**）。
- `out-server/` 是**扁平**产物（`server-main.js` 直接在里面，没有 `product.json`/`package.json`/`out/`）；运行时按 `<checkout>` 解析 `node_modules`，**`product.json` 读的是 checkout 根那份** ⇒ 盖章要盖根那份（`build.mjs` 现在盖 `.`/`out-server`/`out-server-web`）。
- 跑法（cwd = checkout）：`node out-server/server-main.js --port 3091 --host 127.0.0.1 --without-connection-token --server-data-dir … --extensions-dir … --user-data-dir … <folder>`。
- **装扩展**：`server-cli --install-extension` 被守卫挡住（`src/vs/server/node/server.cli.ts:94` 要求 `VSCODE_IPC_HOOK_CLI` 或 `VSCODE_CLIENT_COMMAND`）；手工装 = 解包 VSIX，把 `extension/` 移成 `<extensions-dir>/<publisher>.<name>-<version>/`，删 `extensions.json`，重启。
- **实测（2026-09-15，验证后已撤装）**：GitLens `2026.9.92030` 装上后 `extensions.json` 只列它；`gitlens.views.welcome` / `…repositories` 都能 `mountViewInto` 挂进 prac（有 pane、有标题、有像素）⇒ 扩展**确实激活**；`spdlog` native 缺失仍是既有非致命缺口。
- **安装的正当路径**：`server-cli --install-extension` 走的是 **CLI 管道**（`VSCODE_IPC_HOOK_CLI`），现实里由 **VS Code 的集成终端**提供；我们还没有它 ⇒ **决定 19（terminal 用 VS Code 的）会带出这条管道**。在此之前**不装用户扩展**（第六门 SKIP）；手工解包属于"绕过有意关上的门"，James 2026-09-15 裁决不做。

### Server（自建 code server）

- 服务端产物在 `out-server-web`（**不是** web bundle）：`node out-server-web/out/server-main.js --port 3091 --host 127.0.0.1 --without-connection-token --server-data-dir … --extensions-dir … --user-data-dir … <folder>`；数据目录重定向到仓库内 `.build/vscode-server/`（不重定向会写 `~/.vscode-server-oss`）。
- **`product.json` 必须盖章**（commit = checkout 的 HEAD），否则两侧 segment 不一致（见踩坑 §7.A）。
- distro 布局必须 `<root>/{product.json, package.json, out/}` 且 `<root>` 在 checkout 内（否则报 `Cannot find package 'cookie'`）；`--out` 必须是**相对路径**。
- `server-cli --install-extension` 被环境守卫挡住（"only available in WSL or inside a VS Code terminal"）。
- server-web 构建（313MB/20 bundles）**自带客户端启动失败**：HTML 引用的 `/oss-dev/static/out/…` 全 404（构建输出与服务端静态路由根没对齐）——所以我们用 web bundle 当客户端。
- 不要 desktop / server 目标当成本工作的目标：server distro 只作为 code server 使用。

### 我们自己的机制

- 座位契约 = `prac.view` 槽；机制**按注册表成员**判定座位，不按 id 前缀。
- `pracVscode` 服务面 = 工作区解析（来自 DSH 会话/工作区注册表）+ view→part 映射；机制（boot / part host / 主题 / 命令）在 `prac-vscode-embed`。
- 页面级状态只有一处：`globalThis.__vscodeEmbed`（`VscodeEmbedPage`）。
- 构建期契约只有一处：`vendor/vscode/overlay/bridge.ts`。

## 7. 踩坑与根因

### A. 通道与代理

| 症状 | 根因 | 修法 / 规则 |
| --- | --- | --- |
| 页面里 WS 1006、编辑器打不开文件 | 两侧 **product segment 不一致**（server 运行时算 `oss-dev`，客户端按 build 注入的 commit 要 `/oss-<commit>`） | `stampServerCommit()` 盖章；**表现不是路径不匹配**，所以要看段值 |
| HTTP 代理 404（段已一致） | DSH 前缀匹配要求 **`/` 边界**：`/oss` 与 `/oss-` 都匹配不到 `/oss-dev/version` | 路由 = **整个 segment**；实测 `MATCH prefix=/oss-dev path=/oss-dev/version` |
| WS close 1006（HTTP 通） | `registerUpgrade` 是**精确路径**匹配，只注册 HTTP 前缀没用 | 同一 segment 同时注册 `register({kind:"prefix"})` 与 `registerUpgrade({path})` |
| `/prac-vscode/*` 全 404，而**独立页 smoke 正常** | 路由处理器拿到**完整 pathname**，没人剥掉挂载前缀 | 机制侧收 `mountPath` 参数；**只看 smoke 会假绿** |
| `apply` 中途抛错带走其它路由（两条路由一起 404） | `codeServerPath()` 从错误目录上溯必然抛错 | 失败返回 `undefined` + warn；代理整段 `try/catch`；最坏降级为"没有代理" |
| WS 已通/没通判错 | `wsErrors: []` 被当成成功证据 | **空错误列表可以意味着"什么都没发生"**：先写判据（路由 200 / 有像素 / 有连接日志） |

### B. 渲染与布局

| 症状 | 根因 | 修法 / 规则 |
| --- | --- | --- |
| 整页白屏 | 区域 `position:absolute; inset:0`，宿主父容器 `position: static` ⇒ 包含块一路向上 | 宿主自己 `position: relative`；**像素级验证才发现** |
| 部件已挂载、零报错、不可见 | part 容器的区分性 class 缺失 ⇒ CSS `.monaco-workbench .part.editor > .content .grid-view-container { height: 100% }` 命中不到 ⇒ 内部 grid 塌成 0 | 按经典表复刻 class + 标签 + role + side/position |
| 加 per-region Grid 仍空白 | 经典与 sessions 都靠 `SerializableGrid` 定位；绕过 grid 直接塞 DOM ⇒ `position: static`、tab bar 在 y=-63 | 容器 class + host 机制，后由区域树/sash 取代临时 grid |
| 放好部件后轨道被关掉 | 被遮蔽者的卸载清理 `syncPresentation({shown:false})` → `closeRightbar()` 落在我们的 `openRightbar` **之后** | 放好部件后再断言一次轨道 |
| 部件被搬进瞬时 0 宽 host ⇒ 只有 15 种颜色（纯背景） | 按 0 尺寸布局，轨道随后打开没人重排 | host 加 `ResizeObserver` 触发 `layout()` |
| sash 只有下界没有上界（`left` 长到 1350，两个面板被挤成 0） | ①clamp 只用相邻 leaf 的 min ②flex leaf 的 `min-width: 0` 没表达在分割轴 | 预算改 `extent − sashes − Σ(其它子树的 min)`；修复后停在 870 / 120 |
| 固定的空 leaf 不占空间 | 搬运唯一视图 = 关掉轨道；新建空面板不可见 | **已定（决定 15/20）**：常驻区一直有视图、stage 分栏必带视图 ⇒ 分栏的门面已改成 `splitView(viewId, side)`（**为 view 建区域**），造空 region 的 `split(regionId)` 已删除 |
| 竖 sash 根本不存在（`no sash matching [data-prac-sash-dir="column"]`） | 分栏的**源 region 是固定尺寸且被搬空** ⇒ `isPresent` 为假 ⇒ 整块不渲染 ⇒ 没有 sash 可拖 | 让源区域留一个可见 view，或让它本身是 flex（flex 区域空着也在）；`verify-layout` 的 column 段就先 `place` 一个 occupant 再分栏 |

### C. 契约与类型

| 症状 | 根因 | 修法 / 规则 |
| --- | --- | --- |
| 类型检查通过但运行时炸 | 手写 `declare module "react"` 让 `ReactNode` 退化 `any` | **`skipLibCheck` 下未解析的类型是真空通过**；改用真 `@types/react`（立刻抓到 TS2769） |
| `dist/client.js` 36 kB → 218 kB、loader 检查红 | `.d.ts` 里的 side-effect import 被**擦除**，`.ts` 里的**不会** | 合并靠**类型导入**；side-effect import 不进 `.ts` |
| 消费方 key 类型塌成 `never` | 在我们发布的 `.d.mts` 里再导出 DSH 类型 ⇒ 内联出两份 `SlotMap` | 发布的只有 prac 自己的名字 + 针对 DSH specifier 的增强 |
| `cannot get property "layout" without inject`、整页失败 | **`x satisfies T` 不是纯类型——表达式会求值** | 显式写进 `inject`；断言保留 |
| 覆盖开关开着时报 TS2769 | tsconfig `paths` 把声明合并**劈成两份** | 机制正确的覆盖必须重定向**解析**，不是文件路径 |
| `?folder=` 被完全忽略 | 那是 VS Code 自带 standalone bootstrap 读的 | 我们的入口是 `create()`，没有那层 |
| `vscode.openFolder` 传 URI 全部报约束错 | 只收真 `URI` 实例，页面里造不出 | 由 workbench 侧代调（补丁加 `openWorkspaceFolder`）；`forceReuseWindow` 必须关（会走只会导航的 `workspaceProvider.open()`） |
| `workspaceProvider.workspace` 不打开文件夹 | 它只把 workspace 转成 **id**（storage/profile 身份） | 打开是 `WorkspaceProvider.open()` 的事（只构造 URL 开新窗口）⇒ 我们那个 `open` 改成明确返回 `false` |
| 会话 id 解析恒 undefined、workbench 永不启动 | 写成 `sessions.current()`（方法），实际是 `sessions.list.getSnapshot().current`；绑定方向是 `WorkspaceView.sessionIds` | 先写判据再动手；接口形状要按真类型核 |
| `main` 里对话与编辑器互斥（提升工件时对话消失） | `main` 是 keyed 单占位 | **未决**：分栏或改用 rightbar |
| 给 bundle 行只配 `./client` 报 `No "exports" main defined` | 每个 bundle 行在两个平面都会被 import | host 半边即使空 `apply` 也必须存在 |
| 机制层承载 DSH 的 slot/service 契约，任一错 ⇒ 整页白页 | 契约有 5 项（四区域槽声明 + `ctx.layout` + `panelInfo` + 主题 + `document.title`） | 先忠实替换、像素验证，再改拓扑 |
| `Escape` 监听器从来不触发且 `defaultPrevented === false` | workbench 在 **`document` 捕获阶段**就消费了它（路径 `window-capture → document-capture` 后不再冒泡） | 挂 **`window` 捕获**，且只在该面板打开时认领；另修 `[open]` 闭包恒 false 的真 bug |

### D. 工程与工具链

| 症状 | 根因 | 修法 / 规则 |
| --- | --- | --- |
| 整个 DSH 页 `ReferenceError: exports is not defined`，但构建退出码 0 | `pack` 的 **`intro` 字段被静默丢弃** ⇒ envelope 没进产物 | envelope 拼进 `banner`，并在 `scripts/bundle-client.mjs` **断言这行在位**：**"配置字段存在"≠"工具链会用它"** |
| 改名后整棵树不挂载（连 frame 都没有） | 漏改**产物内嵌的 id**（`clientPack(id)` / `--id`） | 改名要连产物 id 一起改；判据是"frame 在不在"，不是"build 成不成" |
| 从别的包复制文件后类型/形状错 | 复制了不同侧/不同槽形状的 `dsh.d.ts` / `ambient.d.ts` | 按"这个包在哪一侧"重写；靠 `vp check` 暴露 |
| HMR 部分重载 ⇒ `duplicate factory registration` | `client-hmr` 行为 | 重构期临时 `disabled`，完成后恢复 `[]` 并留注释 |
| `disabled` 写进 patch 静默无效 | 每条 patch 只索引它**之前**插入的行 | `disabled` 必须排在 `insert` **之后** |
| `vp pack`（host 构建）把 `dist/` 清空 ⇒ DSH 报 `client bundle not found` | 两半产物分两步出 | 同一份 `pack` 配置数组同时出两半 |
| `exports['./client']` 路径改动后页面不对 | 客户端插件清单是**启动时**组装的 | 必须重启 DSH |
| 根 `vp check` 报 16 个文件格式不合，全是 notes/docs | 根 check 覆盖面过宽 | 根 `check` 收窄到 `scripts vite.config.ts package.json`（临时）；**2026-09-15 已按 James 裁决改为**：根 `vite.config.ts` 的 `fmt.ignorePatterns` 只排除 `.agents/notes/`，根 `check` = `vp check .`（代码/脚本/配置/docs 全进） |
| 改了载荷却只重建了 packages：lib 调新面方法时 React effect 抛错、host 消失，而 `check` 与四个闸门仍全绿 | 载荷在 `overlay/` 里，只有 `vscode:build` 会把它放进 checkout | 动 `vendor/vscode/overlay/**` 必须重跑 `vscode:build`；判据是**新门**（`verify-view`）而不是"没报错" |
| 改名后 DSH 起不来 / 页面全 404 | profile 里是**绝对路径 link**；host 半边路由变了 | `pnpm install` 重链 + 重启 DSH（`patchReload: startup`）；DSH 启动要写 `~/.dsh`（沙箱外） |
| 在 checkout 里改了却忘了重新生成补丁 ⇒ 下次构建**成功但改动丢了** | `build.mjs` 顺序：reset → `git clean -fd` → apply patch | 改 checkout 必须立刻重新生成补丁；**载荷只以 diff 文本存在的风险**见下 |
| 产物里冒出 `require("zustand/vanilla")`，而构建退出码 0、页面也可能照样起来 | 依赖没装 ⇒ 打包器只警告 `Module not found, treating it as an external dependency`，**静默**把它留成 external | 正好是 `bundle-client.mjs` 第 2 条断言要抓的：要么声明成平台词（`clientPack(id, { external })`），要么装进来内联。**"构建成功"不等于"产物可加载"** |

**载荷风险（改名后重算）**：改名前补丁 773 行里 **687 行是我们自己的新文件**（真改上游 ~27 行）、只以 diff 文本存在（`grep` 找不到代码、没有类型检查、构建只用 esbuild 转译、`git clean -fd` 会静默丢失）。**改名后这个形状已消除**：补丁 **74 行 delta-only**，我们自己的文件走 `overlay/`（真文件、可 grep、可 review、被 `vp check` 覆盖契约那一份），`git clean -fd` 每次删掉并由 `cpSync` 重新放置。

### E. 验证方法（元教训）

| 症状 | 根因 | 规则 |
| --- | --- | --- |
| `mounted + 0 error` 被判成渲染成功（实际空白） | 从"没有坏消息"反推成功 | 动手前先写**可复现的成功判据**（路由 200 / 有像素 / 有连接日志），再拿它核对 |
| 几何 + 像素质不足以判定上屏 | DOM 级证据 ≠ 像素证据 | **几何 + 像素质 + 归属**三重判定 |
| 23 项全过却漏掉 sash 上界缺陷 | 只测自己走过的方向（只把轨道拖窄，没往反方向拖） | **边界的反方向与极值是必须试的**；独立复核要用真实鼠标 |
| `page.evaluate` 把"没画"报成"通过" | 传字符串函数返回函数本身 ⇒ 静默 `undefined` | 必须传真函数 |
| 闸门/冒烟假红或假绿 | 闸门也是契约消费者：surface id 写死、DOM 属性是 part id 而闸门按 view id、路由漏 strip 时独立页假的绿、`URL` 环境变量漏进 smoke、shell 里残留 `URL=` | 改契约/改名要枚举"谁读了这个值"（含闸门与冒烟）；跑独立页 smoke 前 `env -u URL` |
| 页面自重载时闸门红被当偶发 | 上一页 shutdown 与下一页启动交叠会真坏 | **"页面被自己重载"时闸门红是有效信号** |
| prac 机制的闸门住进了 `vendor/vscode/scripts/` | 顺手复用那边的 Playwright / URL 约定；后果是 **prac 自己的验证依赖 `vscode:build` 跑过**（依赖倒置） | **闸门按归属放**：prac 机制的活体门在 `tests/gates/`（自带 harness + 根 devDep `@playwright/test`），需要 VS Code 侧的集成门留在 `vendor/vscode/scripts/` |
| 门按前缀筛自己的日志，却被纯噪声判红 | gateway 拉插件清单失败那条 `Failed to fetch` 的 **URL 里逐字列出了所有 bundle id** | harness 加**名单式** `isKnownNoise`，`own(prefix)` 先滤噪声再筛（`verify:split` 就先红在这一条上） |
| 持久化落地后，vendor 门里"reload 即回到默认树"的假设失效 | 决定 16 让 reload **恢复上次状态** ⇒ 门里 `page.reload()` 之后不再是出厂布局 | 凡是 reload 后按默认断言的门要么先清 key，要么把该阶段改成"在恢复的树上继续"（`verify-layout` 的 column 段如今是叠加而不是重置） |

## 8. 开放问题

> 2026-09-15 的一轮问答把原先散着的一批收敛了：**已裁决的进决定表**（`2b` / `14`–`20`）或 09-15 note，这里只留**真的还没定**的。

### 需要 James 裁

1. **理想形态是否确认**：`kernel / views / capabilities` 三层与"view 是单位"（决定 2b 已定，三层形态待确认）——方案与代价见 09-15 note。
2. **两套 server 统一**的路线：先"共存 + 共享 workspace"，还是直接"DSH 跑进 code server"（决定 18 只定了先换基座，已完成）。
3. **阶段二**（决策空间 / 以审决策为主界面）：**还不确定**——保持 `proposed`，不表态；C2 叫停的理由也仍待确认。
4. **高级形态（container / part）什么时候真的需要**：逐个 view 组合 vs"把整块 sidebar 原样搬来"。
5. **异步通道**：已定"先不做"，**形态未裁**（选项：最小标记 + 双向服务 / 完整异步线程 / 复用 chat 的留言模式）。

### 已排期、尚未做

6. **能力面（capabilities）**（含上下文入）：B1 已完成（§5），它是 09-15 note 里紧随其后的那块——agent 读数/动作的 settled + provenance + 分页语义见该 note。
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
