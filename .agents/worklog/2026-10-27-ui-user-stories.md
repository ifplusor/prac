# Worklog: UI user stories（grounding）

> 过程/证据，不签字；设计与决策见 `.agents/notes/abandoned/2026-10-27-ui-user-stories.md`。本文件记录 first-launch stories、grounding 与修正。

## 19. 用户故事 peer note（2026-10-27）

- James: UI scheme 里 complex assumptions 跑在 user stories 前面；从第一次启动开始 ground；做一个 peer note。
- 新建 `.agents/notes/abandoned/2026-10-27-ui-user-stories.md`（status: proposed）：S0 first launch（no workspace）→ S1 first workspace → S2 first session/plan → S3 first file/attention → S4 first review → S5 first Work → S6 desktop switch → S7 failure/takeover → S8 plugin → S9 workspace switch → S10 return → S11 768/keyboard。
- Findings: workspace 是 first-run 的第一个问题；single stage + focus/reference 就够（virtual desktops 是 later）；review（plan/checks/approve/request changes/takeover/revert）是当前 app 缺得最多的；Work 是 preset；OS-like/app registry/freeform 是 later。
- MVP: S0/S1/S2/S3/S4/S7 must；S5/S10/S11/S8 should；S6/multi-desktop/freeform/app registry later。Smallest next：attention + review + Work。
- UI scheme note 现在标为 target；Summary/Motivation/Decisions 加了 MVP vs later 和 peer note 链接；Related 加了 user-stories。
- 代码仍 pre-OS；workspace/project 基座已有；下一步是 stories 的 MVP，不是整个 OS-like。

## 20. S2 修正：plan 是 workspace note（2026-10-27）

- James: S2 中的 plan 现在是作为 note 存在的，只是 workspace 的文件。
- peer note S2 改为：agent 把 plan 写成 note；人在 editor 打开 / 编辑；approve / request changes 在 chat；不是 plan app。Derived #7 / assumptions / findings / MVP / current app / S7 / validation 同步；当前 app 的 plan note 已有，gap 是 approve / request changes 流程，不是 plan 表示。
- UI scheme 把 Plan 从 app 列表 / kind 移除：Plan 不是 app，是 workspace note；Agent 桌面 chat + plan note；editor 是编辑面；chat approve；Summary / Terminology / diagram / Stage / Agent backend / Decisions / Open / Validation 同步。
- 代码仍 pre-OS；plan note / editor / chat 已有；下一步是 S2 的 approve / request changes 流程 + S4 review + S5 Work。
