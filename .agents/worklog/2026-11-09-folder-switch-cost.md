# Worklog: folder 切换成本（过程/证据）

> 过程/证据，不签字；相关设计见 [product-experience](../notes/in-progress/2026-11-05-product-experience.md)、[tech-agent](../notes/in-progress/2026-11-05-tech-agent.md)。

## 方法

- 新探针 `tests/gates/verify-switch-cost.mjs`，opt-in（`vp run verify:ui -- switch-cost`），在 3184 的 throwaway rig 上跑。
- 两个临时 folder A / B；走 title bar 实际使用的 `?workspace=` 导航（`location.replace`）。
- 每次都等到：frame + `__vscodeEmbed.face` + `workspaceInfo` 指向目标 folder + 至少一个 region；再等 2.5s 让 workbench 稳定。
- 首次 editor 的等待是等 `.monaco-editor` 真正出现；dirty 是通过真实键盘输入产生的，不是测试标志。

## 数据（2026-11-09，一次运行）

| 动作 | 耗时 |
| --- | --- |
| 首次 A（shell ready） | 804 ms |
| 首次 A 的 first editor | 215 ms |
| reload A | 726 ms |
| A → B | 826 ms |
| B → A | 737 ms |
| 切换后重开 editor | 134 ms |

状态：

- 切到 B、再切回 A 后：`listOpenFiles()` 为空；reload 与切换都**不恢复打开的 editor**。
- 切换前 A 有一个 **dirty buffer**（a.txt）；切回 A 后 `dirty` 为空——**未保存的修改被丢掉了，没有提示**。
- 布局是恢复的：切换前把 left 拉到 340，B 是 280，切回 A 后 left 又是 340；`prac-layout`/`prac-space` 的 scoped key 从 3 变成 4（每个 folder 一套）。

## 推断

- 「切换 = 重新打开 VS Code」在**时间**上不成立：warm code server 下，shell ~0.8s、first editor ~0.15s，总代价 <1s；慢的不是 boot。
- 在**状态**上成立：整页 `location.replace` 把 workbench 的状态一起丢掉；打开的文件、未保存的 buffer、光标/滚动都没回来。VS Code 的热退出/编辑器恢复在这条路径上没有生效。
- 布局/Space 能回来，因为 prac 自己同步写 localStorage；VS Code 的状态没有这个机会。
- dirty buffer 的丢失是**数据风险**，不只是手感问题；切 folder 前必须有保护（提示 / 保存 / 热退出）。
- `__vscodeEmbed.face.openWorkspaceFolder(B)` 是 **no-op**：调用后 URL、`performance.timeOrigin`、face、`workspaceInfo` 都不变，没有 popup；console 里只有 `[lifecycle] Long running operations during shutdown are unsupported in the web (id: join.disconnectRemote)`。workbench 试过 shutdown/切换，但 web 下不支持，命令没有落地。in-place 路径在当前 embed 里不可用。
- 页面 reload 后 `open=[]`，说明 workbench 的状态没有被 flush/恢复；hot exit 在这条路径上没有生效。

## 对「单 workbench vs 多 workbench」的影响

- 单 workbench 的时间成本可接受；真正的取舍是**状态是否保得住**。
- 若能把 workbench 状态恢复（热退出 / in-place 换 folder）做出，单 workbench 明显更省资源，也符合「一个世界」的假设。
- 若保不住，多 workbench 的价值不在速度，而在**每个窗口的 editor 状态一直活着**；代价是两份 IDE + per-window 状态（`dsh.sessions.current`、Space 的共享键）要重新设计。

## 下一步

1. 诊断 `openWorkspaceFolder` 为什么没生效；如果它能让 workbench 内换 folder 并保住状态，这是单 workbench 的关键路径。
2. 查嵌入 workbench 的 hot exit / open-editor restore 设置；当前 reload 后 open=[]，说明恢复没开或没写入。
3. 无论选哪个模型，先给 dirty buffer 加保护。
4. 复测：同样的探针，在状态恢复实现后再跑一次。


## 多 tab / 多 folder 探针（2026-11-09）

`tests/gates/verify-multitab.mjs`（opt-in）在同一个 browser context 里开三个 tab：

- tab A（alpha）/ tab B（beta）/ tab A2（alpha，同 folder 第二个 tab）。
- 三个 tab 都完成 boot，各自 `workspaceInfo` 指向自己的 folder：A=alpha、B=beta、A2=alpha。**两个不同 folder 的 workbench 可以同时存在**，code server 没有拒绝。
- `dsh.sessions.current` 是同一个 localStorage 键：三个 tab 读到同一个 session id；这是跨 tab 共享的选择。
- `prac-layout/v1/*` 在这个探针里是 0 个——因为没有交互；switch-cost 里 resize 之后才出现按 workspace scoped 的 key。同一 workspace 的两个 tab 会写同一个 key，后写者覆盖。

结论：多 tab + 多 folder 在**服务端和 workbench 层**已经可行；限制在 prac 的 UI 状态作用域（session 选择、layout/Space 都是跨 tab 共享的），以及缺少「在新 tab / 新窗口打开」的入口。

## 决策：一个 folder 一个 tab（2026-11-09）

- 多显示器 = 多个 tab / 窗口，每个 tab 一个 folder；**同一个 folder 不做第二个 tab**（重复打开聚焦已有 tab）。
- session / Space 在 tab 内切换——它们便宜，不需要第二个 tab 来「占住」。
- aux 概念删除：轻量 Monaco aux 没有完整 IDE，完整 workbench aux 就是复制；两者都没有意义。
- VS Code workbench 不能进 SharedWorker（DOM 耦合、同步 model/undo），所以「一个 workbench 多视图」在浏览器里没有免费路径；不接受为了它做 VS Code 的 headless 分叉。
- worker 仍可作为控制平面（DSH 连接、world 注册、per-folder last session/Space、tab 协调），但 workbench 每个 tab 一个。
- 待落地：folder 菜单的「打开 / 聚焦 tab」、per-folder last session、worker 控制平面、多 tab gate。

## 不做 SharedWorker，也不做跨 tab 广播（2026-11-09）

- tab 之间唯一的共享是 Host（agent/session/文件）；prac 侧没有 worker、没有 BroadcastChannel、没有 storage 事件协调。
- 每个 tab 独立：自己的 DSH 连接、自己的 workbench、自己的 per-folder 状态。
- 所以「同一个 folder 已有 tab 就聚焦」不做运行时强制；重复打开是允许的，per-folder localStorage 由后写者覆盖，接受这个限制。
- 一 folder 一 tab 是**约定**，不是跨 tab 强制。
- 剩余需要改的：把全局 `dsh.sessions.current` 换成 per-folder last session；folder 菜单区分「切换当前 tab」与「新 tab 打开」；重复打开不做检测。

## workspace 状态探针（2026-11-09）

`tests/gates/verify-workspace-state.mjs`（opt-in）：打开文件、输入成 dirty、reload，然后在 0.5 / 2 / 5 / 10s 采样。

- `workspaceInfo().id` reload 前后都是 `7ad4aa7e`——**workspace id 稳定**，不是「storage key 变了」。
- open editors 和 dirty 在 10s 内始终为空：**不是恢复慢，是根本没恢复**；hot exit 也没有把 dirty 带回来。
- IndexedDB 里确实有 `vscode-web-state-db-7ad4aa7e`，所以存储存在；问题在 workbench 没有在 reload 时写/读这份状态（硬 reload，没有 graceful shutdown）。

结论：不能依赖嵌入 workbench 的 open-editor restore / hot exit；B（替换当前 tab）必须由 prac 自己做 per-folder 恢复 + dirty 保护。

## 实现（2026-11-09）

- `pracVscode` 增加 `editorState / saveAll / openFile / activate / whenReady`；embed handle 增加 `openFile`（页面构造不出 VS Code 的 URI，必须由 face 做）。
- title bar：
  - 按 folder 存 last session、open editor 列表（`prac-session/v1/<workspaceId>`、`prac-open/v1/<workspaceId>`）；
  - 切 folder 前 dirty → confirm「保存 / 取消」，保存走 Save All；取消则中止；
  - boot 后 face ready → 恢复该 folder 的 session 和打开的文件；
  - `beforeunload` 保存 open 列表，dirty 时触发浏览器离开确认；
  - URL 打开的 folder 通过 `workspaces.create({ path })` 注册进 DSH；返回的 workspaceId 用于所有 per-folder key——`/tmp` 与 `/private/tmp` 的路径差异不会再把 key 对错。
- 验收：opt-in `folder-switch` 通过（菜单列出 A/B、A→B、B→A、dirty 已保存、文件回来）；smoke / `vp check` / 全仓 build 全绿。
- 未做：folder 菜单的「在新 tab 打开」动作（当前默认 B：替换当前 tab）；per-folder session 的 UI 断言；reload 时 console 仍有 `Long running operations during shutdown are unsupported in the web`（已知 web 限制）。

## P0 入口（2026-11-09）

- title bar 的 folder 菜单加 **Open folder** 输入（Open = 替换当前 tab；↗ = 新 tab），每个 workspace 行加 **↗ 新 tab**。
- `workspaces.create` 先注册、再 reload；新 tab 走 `window.open(?workspace=…)`，由新页的 adopt 逻辑注册。
- 新 gate `folder-entry`（opt-in）：Open folder 到达 C；new-tab 在第二个 tab 到达 A。通过。

## 全量验收与 file gate 更新（2026-11-09）

- `verify-file` 的第 10 段从「reload 忘记文件」改为「reload 恢复该 folder 的 open set」：这是本产品的新行为；同时修了 first-run 点击后导航与 `installDeepDom` 的竞态（先等 navigation 再注入）。
- `folder-switch` / `folder-entry` 从 opt-in 升为正式 gate；全量 `vp run verify:ui` 全绿（约 232s），folder-switch 14.0s、folder-entry 8.1s。
- 三个诊断探针（switch-cost / multitab / workspace-state）仍是 opt-in。

## 默认屏幕审计（2026-11-09，rig）

- 证据：`.build/audit/default-screen-collapsed.png`、`.build/audit/default-screen-session.png`（1600×1000）。
- 事实：打开 folder 后，中心的 tab strip 是 `Chat × Sidebar`，body 空白；左侧是 Explorer；右侧是竖排 `Chat`；bottom 240px 展开（Debug Console / Problems / Output / Terminal）；标题栏 `New Session / Space 1`。
- 结论：**J1 默认屏幕不达标**——中心 conversation 不可用；bottom 未收起；`dsh:sidebar` 的 state region 是 center，Explorer 是 left。
- 尝试：把 kit `defaultTree()` 的 bottom 改成 collapsed 0 / cached 240 → `ui-kit-workbench` 的单测（断言 240）失败；已回退。bottom 默认收起应在 **prac frame 层** 做，不改 kit 的默认契约。
- 未决：中心 chat 空白是产品缺陷，还是 rig 没有 session / model 的假象？需要在真实 DSH 环境复核。下一轮优先修 frame 默认 bottom + conversation 的默认可见 / active。

## 干净状态复核（2026-11-09）

- 清掉所有 `prac-*` localStorage 后 reload：bottom 高度回到 0（bottom 展开是 **stale frame state**，不是默认）；但中心仍只有 `Chat × Sidebar` tab strip、body 空白，`dsh:sidebar` region 仍是 center。
- 点 `+ New Session` 后仍空白，`Bring the conversation...` notice 仍在。
- 结论：**J1 默认屏幕缺陷不是 stale state**（至少在 rig 上）；bottom 收起无需改 kit（已回退），真正的问题是 conversation 默认不可见 / inactive。下一轮应在 frame / DSH adapter 层定位，并到真实 DSH 环境复核是否 rig-only。

## conversation 空白的根因假设（2026-11-09）

- `ui-conversation` 注册 `main` slot：`key: "conversation"`、`scope: "session-maybe"`。
- `prac-client-dsh-host` 的 `contentFor` 只做 `render("main", {}, { entryKey: "conversation" })`；它没有给这个 session-scoped slot 提供 DSH 的 session provider / scope。
- 实验：title bar 在 URL folder boot 时 `openWorkspace(workspaceId)` 连接一个 blank session 并 reveal。结果中心仍然空白（`Chat × Sidebar`，body 空），说明问题不是「没有 session」，而是 slot 渲染时缺少 session scope/provider。实验已回退。
- 下一轮：在 dsh-host / extension 层给 conversation slot 包上 DSH session provider（或复用 DSH layout 的 conversation panel），再复验干净状态与真实 DSH。

## 中心 content host 是空的（2026-11-09）

- 直接 dump 中心 region 的 DOM：tab strip 下面是 `1272×700` 的 content div，**children 为空**。
- 这排除了「内容被压成 0 高 / CSS 尺寸」的解释；`render("main", {}, { entryKey: "conversation" })` 返回了空。
- 两种可能：
  1. `ui-conversation` 的 `main` slot entry 没有注册（composition 里没装该 UI 插件）；
  2. entry 在，但 `session-maybe` scope adapter 缺失 / current session 为空，panel 渲染空。
- 下一轮：在 `prac-client-dsh-host` 加只读诊断（`slots.entries('main')`、`slots.scope('session')`、current session），先判断是哪一种，再修 composition 或 session scope。

## DSH slot / session 诊断（2026-11-09）

- `main` slot：`kind: "keyed"`、`scope: "root"`；entries 里有 `plugins` / `conversation` / `schedules`，**conversation 已注册**。
- `uiSession` 存在、adapter 存在、current session 是 `session-cc4e…`；**session 也不缺**。
- 中心 content 仍空；hide/show 之后中心显示 **"Bring the conversation forward"**。
- 结论：不是 slot 缺失、不是 session 缺失；conversation panel 渲染的是 **session-area 的 "bring forward" 空分支**——prac frame 没有向 DSH session area 提供 visibility / foreground 状态（`ui-layout` 被 disable，prac 用 `pracFrame` 替代）。
- 下一步：在 frame 层实现 session-area visibility 契约（或保留最小 `ui-layout` 状态并桥接），让 conversation 认为自己在主区域前景；再复验。

## 更正 + ui-layout 实验（2026-11-09）

- **更正**：`"Bring the conversation forward"` 是 **prac 自己的 window action label**（`packages/client/ui-workbench/src/client/index.ts:1120`），不是 DSH session-area 的空分支。上一轮把“hide/show 后出现这句话”当成 foreground 缺失的证据，是误读；foreground 假设不成立。
- 临时启用 `ui-layout`：web boot **8 entries did not activate**，`prac-client-ui-frame: failed`，页面 `Failed to load plugins`。两套 layout 在 root/service 层冲突，**不能简单 re-enable** 作为 fallback。
- 已回退；重建与 `vp check` 绿。
- 现状：`main` slot 注册了 `conversation`、`uiSession` adapter 与 current session 都存在，但中心 content host 为空；frame 的 `renderSlot` 对 DSH conversation 返回空的原因仍未定。
- 决策：给 frame 的 conversation re-host **2 轮 spike 时间盒**；若仍不能渲染，再评估 hybrid（DSH shell 做主区域 + prac 外层 chrome）这一架构级改造。

## 直接 renderSlot spike（2026-11-09）

- 在 frame 根部直接 `renderSlot("main", {}, { entryKey: "conversation" })`：中心渲染出 conversation 的 hero / composer（"Into the Unknown"、"Describe what you want to build…"、"Select model"）。
- 结论：**slot、session、conversation panel 都正常**；问题在 app-window 的 content host / isolation 路径（`windowContentFor` → `LayoutIsolation` → `LayoutItem`）——DSH slot 在那里渲染为空。
- 下一轮：让 app content 在 frame 的 React 树内渲染，或桥接 DSH slot 的 React 上下文（content host 单独 root 的问题），而不是继续查 slot/session。

## J1 修复（2026-11-09）

- 根因：DSH host window 经 app-window 的 `windowContentFor` → `LayoutIsolation` portal → `LayoutItem` 渲染时，DSH slot renderer 的 React context 丢失；而直接在 frame 树里 `renderSlot("main")` 正常。
- 修法：DSH host window 在 frame 树内用每窗口组件 `DshHostWindowBody` 渲染它的 host slot（`main` / `sidebar` / `rightbar`）；hooks 按窗口稳定，不触发 hook-order。其它 host 仍走 isolation。
- 默认屏幕：DSH sidebar 在 boot 时隐藏一次（之后用户 recall 仍可打开）；不再自动打开 terminal；panel 容器不再默认放进 bottom（需要时从 dock/recall 打开）。bottom 默认空/收起。
- gate：`default-screen` 升为正式 gate；`bottom` 的 premise 改为「默认空」；`file` 等 restore 而不是等 no-tabs；`editor:group` 在方向 focus 前先聚焦 editor。
- 验证：`vp run verify:ui` **all gates passed**（224.4s）；`vp check` 绿。

## DSH rc.2 升级：修复 rc.2 session 历史加载（2026-11-10）

- 客户 dogfood 反馈：历史 session 加载失败，`job/registered` 对当前 harness 未知，session 由更新的 harness 写入（raw log 在 `~/.dsh/sessions/...`）。
- 证据：`dsh-master`（2026-10-17，release 0.2.1-rc.2）的 `known-event-types.ts` 包含 `job/registered`；prac anchor `dsh-prac-dev`（2026-10-09，0.2.1-alpha.2）没有。
- 动作：
  - `pnpm-workspace.yaml` 的 32 个 DSH catalog 条目 alpha.2 → **0.2.1-rc.2**；`pnpm install`。
  - `dsh-prac-dev` anchor 从 alpha.2 rebase 到 rc.2（687f282e86），保留 prac 的 auth redirect patch（`?workspace=` 穿过 303），anchor commit `8c81ed6757`。
  - anchor `pnpm install` + client types rebuild。
- 验证：`vp check` 绿；全仓 build；`vp run verify:ui` **all gates passed**（rc.2 客户端）。
- `dsh-types --compare`：32 包比较，**4 个 published-vs-checkout 漂移**（api-workspace-controller / client-connection / ui-chat / ui-conversation），不是产品的 session 问题。
- 生效条件：**重启 prac dev server / DSH anchor**，然后客户重试历史 session。

## Copilot / VS Code Chat（2026-11-10）

- 客户裁决：不要 Copilot 的 chat。
- 动作：`chat.disableAIFeatures: true` 默认（隐藏内建 AI/chat）；在 code server 启动前把 `github.copilot-chat-*` 扩展目录移到 `extensions-disabled/`（`--disable-extension` 对 server 不支持，日志已证）。
- **仍未解决**：第一屏仍显示 Open Editors 的 “Chat” 行和右栏 Chat 图标；`face.listOpenFiles()`/`editors.snapshot()` 为空，说明它不是普通的 VS Code 文件编辑器，可能是被 profile 恢复的内建 Chat 视图/编辑器。需要关闭/清除持久化的 Chat UI，或对 built-in chat 的 view container 做排除；不是 CSS 隐藏。
- 全量 `vp run verify:ui` 仍 all gates passed。

## VS Code Chat 的真实身份（2026-11-10）

- 移除 `.build/vscode/extensions/copilot`（built-in 的 `GitHub.copilot-chat` 扩展）后，第一屏的 Open Editors “Chat” 行和右栏 Chat 图标**仍然存在**。
- 结论：它不是 Copilot 扩展，而是 **VS Code core chat**（`src/vs/workbench/contrib/chat`）。`chat.disableAIFeatures` 和扩展 quarantine 都不会移除 core chat 的 view/editor。
- 正确的移除需要在 **vendored VS Code build 层**去掉 chat contribution（`vendor/vscode/overlay` 对 workbench contribution 的 patch），或接受 IDE 自带 chat；不是 `EXCLUDED_VIEWS` / CSS 能解决的。
- 当前 product code：`chat.disableAIFeatures` + `copilot-chat` quarantine（`e9bdf73`）；core chat 仍在。

## Core chat container 移除（2026-11-10）

- `vendor/vscode/overlay/chatParticipant.contribution.ts`：不注册 core chat 的 AuxiliaryBar view container/view；`build.mjs` 增加 overlay 映射；`vscode:build` 通过；`vp run verify:ui` all gates passed。
- 第一屏仍显示 Open Editors “Chat” 和右栏 Chat 图标：它们来自 **built-in GitHub.copilot-chat 扩展**（`.build/vscode/extensions/copilot`，build 会重新 copy）以及被 profile 恢复的 chat editor，不是刚移除的 core container。下一步是 build 层过滤 built-in 扩展/`extensions.json`，并清掉恢复的 chat editor。

## Chat editor 是 core 的，不是扩展（2026-11-10）

- `.build/vscode/extensions/copilot` 实际已不存在（build 不会恢复它）；移除它之后第一屏的 Chat 仍在。
- 因此 Open Editors 的 “Chat” 是 **VS Code core chat editor**（`chat.shared.contribution.ts` 里的 editor pane / resolver / serializer 注册），不是 Copilot 扩展，也不是我们已移除的 AuxiliaryBar container。
- 右栏的 “Chat” 很可能是 **prac 自己的 DSH chat**（产品主 chat），不是 Copilot。
- 下一步只有两条：给 `chat.shared.contribution.ts` 做第二个 vendor overlay，去掉 core chat editor 的注册；或重置 VS Code workbench 的 restored editor state（后者有 dirty buffer 风险）。前者干净但文件大（3403 行）。

## Core chat editor overlay（2026-11-10）

- `vendor/vscode/overlay/chat.shared.contribution.ts`：移除 `ChatEditor` pane 注册、`ChatResolverContribution` 注册、`ChatEditorInput` serializer；debug/agent-plugin editor 保留。
- `vscode:build` 通过；`vp check` 306 文件绿；`vp run verify:ui` all gates passed。
- Open Editors 的 “Chat” 仍在：它是 **persisted restored editor state**（workbench 恢复旧 editor；注册被移除后变成不可解析的 tab/placeholder），不是活的 Copilot chat。右栏 “Chat” 是 prac 自己的 DSH chat，保留。
- 下一步：清掉 VS Code 的 restored editor state（prac 自己的 per-folder open restore 是来源；有 dirty buffer 风险），或接受这个 placeholder。

## Dead Chat tab 在 client IndexedDB（2026-11-10）

- 服务端 `workspaceStorage` 只有 `vscode.lock`，没有 `state.vscdb`；workbench 的 editor state 在**浏览器 IndexedDB**（`vscode-web-state-db-<workspace>`，早先探针见过）。
- 所以 Open Editors 的 “Chat” 是 **client-state migration artifact**：live chat UI 已从 vendored build 移除，旧 profile 的 editor state 仍被恢复成死 tab。
- 两条：一次性清掉这些 VS Code web state DB（prac 自己的 per-folder open restore 会重开文件；dirty buffer 风险），或接受死 tab。live Copilot chat 已经没有。

## Fresh-context Chat 反证（2026-11-10）

- 全新 Playwright context（无旧 IndexedDB）第一屏仍有 Open Editors “Chat” 行，且该行 `focused selected`。
- `face.listOpenFiles()` / `editors.snapshot()` 都为空，说明它不是 file placement，而是 VS Code 的 Chat **webview/editor**（不在 editors capability）。
- 右栏 “Chat” 是 `dsh:rightbar`（prac 自己的 DSH chat），保留。
- 结论：**一次性清 IndexedDB 不会移除它**——它是启动时实际打开的 VS Code Chat editor，不是纯持久化状态。下一步要么接受，要么在 VS Code editor/startup 层做排除；不做盲清。

## 3084 重启 + boot 验证（2026-11-10）

- `node scripts/link-profile.mjs --profile prac-dev` 后，`dsh --profile prac-dev --dump-config` 组合正确（remote-access 在、ui-layout disabled、旧包消失）。
- 停掉旧 3084（PID 40749），用 `node apps/cli/lib/bin.js --profile prac-dev --port 3084` 重启；Playwright 打开页面：无 “did not activate”，`__vscodeEmbed.face` 就绪，第一屏是 “Into the Unknown / New Session” 对话。
- 31 entries 是 re-link 前的旧 profile；重启即恢复。
- 顺手清掉 code-server extensions 里上次 gate 留下的 `prac.probe-appears-1.0.0`。
- 仍需客户打开那个 rc.2 session 验证历史；Chat（VS Code editor + dsh:rightbar）仍在。

## rc.2 session 历史验证（2026-11-10）

- 重启后的 3084，在 `rc_ifplusor` 工作区打开失败 session（`session-a577f9f1-…`，标题「查看 AI 编程作业 PDF」）：
  - 会话内容、Trajectory、「Load earlier」都出现；
  - **没有** `Failed to load history`；日志里 536 个 `job/registered`，rc.2 能读。
- 控制台仍有 `SignatureVerificationInternal: Signature verification was not executed.` 的 pageerror、几个 404、以及 GitHub auth 超时，但都不是历史加载；下一轮查 signature 那个。
- 第一屏仍有 VS Code Chat editor；右栏是 dsh:rightbar。

## Session 控制台根因（2026-11-10）

- `SignatureVerificationInternal`：VS Code 扩展管理在安装/更新时验签；web 侧 `node_modules/vsda/rust/web/vsda.js|wasm` **404**，所以 `verification was not executed`；`extensions.verifySignature: false` 的 default 不会覆盖用户已有设置，pageerror 仍在。产品侧要 serve vsda 或强制该设置。
- `/api/changes.summary` **404**：vendored alpha.2 deliverables client 调用该路由，rc.2 的 host 路由没有被服务/组合——**changed-files card / J2 review 是坏的**，这是 MVP 楔子的核心，下一轮优先。
- 另：GitHub auth 超时（GitLens）与本次无关。

## J2 changed-files 验证（2026-11-10）

- 新 session / 新 turn 创建 `prac-j2-check.txt`：`/api/changes.summary?sessionId=session-1ca07c9e…&seq=28` 返回 **200**，页面出现 “Edited prac-j2-check.txt  +1 -0”。
- 所以 J2 card 在新 session 上正常；旧 session 的 404 是 `@deepseek-ai/dsh-workspace-changes` 的 host-memory summary 在重启后丢失（`types.ts` 契约），不是路由 bug。
- 测试文件与测试 session 已清理。

## J2 card → diff 验证（2026-11-10）

- 新 turn 创建 `prac-j2-diff.txt`：card 出现，`/api/changes.summary` 200；点 card 打开 `Turn 1 · prac-j2-diff.txt`，diff 可见。
- 即 J2 的 card → diff 链路打通；request changes / 人工改是交互动作，不需要再验核心。
- 测试文件已清理；测试 session 清理中。

## containers gate 对齐 board 模型（2026-11-10）

- 失败事实：file place 后落在 `left/container:workbench.view.explorer/stack/...`，`editorsInSidebar=0`、`boardMapped=false`。
- 根因：`planViewGroups` 明确跳过 container 组（container = board window，不是 WindowGroup），gate 却要求 file 进 sidebar 的 WindowGroup。
- 这是验收口径与产品模型冲突，不是 rc.2 回归。gate 改为验证 file 落在 container 区域（board/stack）。
- 全量 `vp run verify:ui` 恢复绿；`vp check` 绿。

## J2 review loop dogfood（2026-11-10）

- 第一轮：`Create a file named prac-review.txt containing the word hello` → card `Edited prac-review.txt +1 -0`。
- 第二轮（request changes）：`Change the word … from hello to world` → `Completed in 2s`，文件改为 world。
- 即 J2 的 card → diff → request changes → 再改 全链路可用。
