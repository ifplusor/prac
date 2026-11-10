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
