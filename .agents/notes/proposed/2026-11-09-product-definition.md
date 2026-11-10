---
status: proposed
---

# Product definition — the review-and-switch workbench

> 这是我（产品经理）提出的 L0 定义，James 是最终客户。接受后，它收敛 [product-design](../in-progress/2026-11-05-product-design.md) / [product-mvp](../in-progress/2026-11-05-product-mvp.md) 的方向；未接受前，旧 note 仍是当前方向。

## Summary

prac 是**单人、自用的 agent 工程工作台**：把对话、代码、变更证据、笔记放在同一个界面里，让 agent 的产出**可审阅**，让多项目之间的**切换**不丢上下文。

它不是「更聪明的 agent」，也不是「功能更多的 IDE」。它押的是：**agent 能力已经够用，瓶颈在人这一侧的审阅、信任和切换。**

## The bet

产品成立需要三件事同时为真：

1. 审阅一个 agent turn 比「VS Code + 一个聊天窗口」更快、更清楚——不用在工具之间搬运上下文；
2. 项目 A ↔ B 的切换能恢复工作现场（session / 打开的文件 / 布局 / Space / dirty 保护）；
3. 计划、决定、依据作为文件留在同一个工作台里，而不是散在别处。

**如果第 1 条在 dogfood 后被证伪，自研工作台就不成立**：应该退回到「VS Code 扩展 + DSH」的薄集成，而不是继续加窗口/布局功能。这个证伪条件是定义的一部分，不是失败后的借口。

## 用户与 Jobs（MVP 只承诺三个）

唯一用户 James：资深工程师，维护多个项目，日常用 agent 改代码，多显示器。

1. **就地审阅**：agent 干完 → 看改了哪些文件 → 看 diff/证据 → request changes 或接受 → 人工改 / git revert。
2. **多项目切换**：从 A 切到 B、再切回 A，现场（session、文件、布局、Space、未保存修改）都回来。
3. **计划与决定留在代码旁**：plan 是 note，决定是 note，依据可追溯。

不承诺（MVP）：扩展生态、多窗口/free window、自动布局、多用户、MCP。

## MVP（一个可签字的版本）

### Must

- **首次运行 + 打开 folder**：最近 folder / 路径输入；一个 folder 一个 tab；支持「在新 tab 打开」；folder 注册进 DSH。
- **chat / session**：继承 DSH；session 切换；approval 呈现在 tool call；后台状态可见。
- **编辑器**：打开文件、active window、editor group；terminal / SCM / search / problems 可用，但不作为差异化验收。
- **审阅闭环**：changed-files 卡（DSH 卡）→ 点文件开 prac 的 turn-scoped diff；checks 留在 chat / tool calls；request changes 走 chat；human edit / git revert；不新增 review application / checkpoint。
- **folder 切换 / 回来**：per-folder session / 打开文件 / active / 布局 / Space 恢复；切走前 dirty → 保存或取消；切回后文件重新打开。
- **notes / plan**：notes 是文件；plan 写在 note 里；不做第二套文档系统。

### Should

- chat 收起 / panel 恢复；Space 的创建 / 切换；GitLens（只验证一个扩展，不承诺生态）；768 / 键盘。

### Later

- 扩展生态 / 市场；多窗口 / free window；MCP；自动注意力跟随；完整 i18n / a11y；application 产品化（pin / launcher）。

### 明确不做（MVP）

- 多用户 / 托管 / 登录；VS Code 的布局；plan/review application、checkpoint、takeover 对象；给 agent 加它没有的能力；同 folder 多 tab / aux；SharedWorker / 跨 tab 广播（当前裁决）。

## 三个核心旅程

**J1 第一次**：打开 folder → 默认布局（chat + editor + Explorer）→ 第一句 prompt 或第一次编辑。验证「第一次有用动作」的时间。

**J2 审阅**：agent turn 结束 → changed-files 卡 → 点文件看 diff → checks/chat 里 request changes → 人或 agent 改 → git revert 兜底。验证「不切工具」。

**J3 切换**：A 的 agent 在跑 → 在新 tab 开 B → 在 B 工作 → 回 A：session/文件/布局回来，A 的 running 仍可见。验证「切换成本 + 恢复成功率」。

## 指标与证伪

| # | 指标 | 目标 |
| --- | --- | --- |
| M1 | 从打开 folder 到第一次有用动作 | < 2 分钟 |
| M2 | A→B→A 的状态恢复（session / open / dirty / layout / Space） | 10/10；editor 可用 < 3 秒 |
| M3 | 一个 turn 的审阅闭环：turn 结束 → 决定 | 0 次工具切换；3 次 dogfood/周 |

- 不做 telemetry；指标由 James 在 dogfood 中手工记录（次数 / 计时 / 主观摩擦）。
- **证伪**：连续两周 M3 不比「VS Code + chat」更好 → 停止自研工作台，退回薄集成。

## Roadmap

- **P0（现在）**：Open folder / Open in new tab；把 folder-switch 升为正式 gate + per-folder session 断言；first-run / 默认布局；提交设计与签收。
- **P1（MVP 验收）**：J2 审阅闭环的验收场景；chat 收起；Space；768 / 键盘；note 共编冲突策略。
- **P2（质量）**：性能预算（切 folder / 多 tab / 内存）；GitLens 兼容；a11y / i18n；`dsh-types` anchor+pin 前进。
- **Later**：多窗口 / free window、MCP、自动布局、扩展生态。

## 风险

- **范围**：完整 IDE + 扩展 + agent + 自研窗口，对一个人超载；MVP 必须靠 Must/Should 切口守住。
- **差异化**：如果不做 M3 的证伪，容易变成「又一个带 chat 的 IDE」。
- **数据**：dirty buffer、崩溃、hot exit 不支持；切 folder 已有保存/取消 + beforeunload 提示，但崩溃仍会丢。
- **依赖**：DSH 发布版漂移（`dsh-types` 红）、turn-diff 依赖 DSH 私有 snapshot、vendored ui-deliverables 需要维护、VS Code embed 的 in-place 切换不可用。
- **维护**：15 份 in-progress notes、无签字 MVP、solo。

## MVP decisions（PM 的裁决，随提案一起签）

这些是当前 notes 里还挂着的产品问题；我按 PM 的判断给出结论，客户可以逐条推翻。

- **默认屏幕**：左侧 Explorer；中间 conversation；打开文件时在中间 group 增加 editor window 并成为 active；右侧保留、默认隐藏；bottom panel 默认收起；title bar 显示 folder / session / Space / layout。
- **首次运行**：没有 folder → 路径输入 + 最近 folder；打开后进入默认屏幕；错误就地显示，不进入死胡同。首次之后，入口是 title bar 的 **Open folder** / **新 tab**。
- **审阅约定**：changed-files 卡只做入口——点文件开 turn-scoped diff；checks 留在 chat / tool calls；request changes 走 chat；human edit / git revert 兜底；**卡上不加 review 动作**。
- **chat**：单 chat；可收起 / 恢复；每个 folder 记住收起状态；不做多 chat 面板。
- **notes / plan**：notes 是文件；agent 通过文件读写；冲突时提示，不静默合并；不做实时协同。
- **扩展**：MVP 只验证 **GitLens**；不承诺任意 VSIX / 市场 / 自动安装。
- **Space**：默认一个；可创建 / 切换；按 folder 存储；panel / sidebar 是 frame 级，不随 Space。
- **多显示器**：一个 folder 一个 tab；新 tab 是显式动作；同 folder 不做第二个 tab / aux。
- **MVP 不承诺**：boards / widgets 的产品化（能力保留，不进验收）、多窗口 / free window、MCP、自动布局、完整 i18n / a11y、application pin / launcher。

## MVP acceptance checklist

| 旅程 | 通过条件 | 证据 |
| --- | --- | --- |
| J1 第一次 | **阻塞**：干净状态下中心 conversation 仍空白（证据 `.build/audit/default-fresh-session.png`），`dsh:sidebar` 在 center。修好后再验「默认屏幕 → 第一句 prompt」 | 手工 dogfood + first-run 场景 |
| J2 审阅 | 一个 turn 的卡 → diff → request changes → 接受/人工改/git revert；不切工具 | 手工 dogfood + changed-files 场景 |
| J3 切换 | A/B 两个 tab；dirty 保存/取消；回 A 恢复 session / 文件 / layout；running 可见 | `folder-switch` / `folder-entry` gate |

- M1–M3 在 dogfood 中手工记录；两周后按 M3 做证伪判断。

## Known blockers

- **J1 默认屏幕**：清掉所有 `prac-*` localStorage 后 reload，中心仍只有 `Chat × Sidebar` tab strip、body 空白；`dsh:sidebar` 的 region 仍是 center。这不是 stale state。根因**未定**：`main` slot 注册了 `conversation`，`uiSession` adapter 和 current session 都存在；但中心 content host 为空。上一轮把 "Bring the conversation forward" 当成 session-area 空分支是误读——它是 prac 的 window action label，foreground 假设不成立。临时启用 `ui-layout` 会 boot 失败（8 entries 未激活，root/service 冲突），fallback 不是配置切换。给 frame 的 conversation re-host **2 轮 spike 时间盒**；否则评估 hybrid（DSH shell 做主区域 + prac 外层 chrome）。修好前 J1 不签。
- **bottom**：stale frame state 会展开 240px；干净状态是 0。不是默认缺陷，不需要改 kit 的 240 契约。

## 需要客户（James）确认

1. 接受「审阅 + 切换」作为 MVP 的楔子，以及 M3 的证伪条件？
2. 接受 MVP 的切口：扩展生态、多窗口、boards/widgets 的产品承诺留到 later（能力可以保留，但不进 MVP 验收）？
3. 确认「一个 folder 一个 tab + 在新 tab 打开」是 P0？
4. 接受 M1–M3 作为 MVP 的成功标准？
5. 这份 note 接受后，是收敛/替代 product-design + product-mvp，还是作为它们的 L0 上层？

## Related

- [product-design](../in-progress/2026-11-05-product-design.md)：愿景 / 问题 / 指标。
- [product-experience](../in-progress/2026-11-05-product-experience.md)：体验 / 入口。
- [product-mvp](../in-progress/2026-11-05-product-mvp.md)：stories / 验收。
- [2026-11-09 folder switch worklog](../../worklog/2026-11-09-folder-switch-cost.md)：切换与恢复的证据。
