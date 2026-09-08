# Agent Notes 索引

> Prac 的**决策记忆**（agent 面向）。这是你跨会话的持久化记忆——每个决策的「为什么 + 放弃了什么」。**开始工作前先读这里**，避免重新论证或与既定方向冲突。

## 生命周期

- **proposed/** — 还在论证/未定案。正文用将来时，允许计划、迁移、开放问题。
- **accepted/** — 已采纳为当前方向。现在时陈述「prac 就是这么做的」。
- **rejected/** — 被否掉。保留仅当其理由能防止一个诱惑性错误；否则删除。
- **archived/** — 冻结的被取代/被否决策。永不编辑，不作当前权威。

> 这套生命周期借用了 RFC 文档状态的形态：`Proposed → Accepted / Rejected → Historic`。用 `accepted` 而非 DSH 的 `implemented`，是因为 prac 目前是「**采纳为方向**」，尚未在 DSH 代码里落地；等某条决策真正实现到 bundle/profile 里时，再考虑 `implemented`。

## 当前状态

- **阶段**：第一个增量 C1（最小可运行 prac-on-DSH）已搭建并验证——独立消费者能扩展 DSH。
- **立身之本（开放问题）**：决策空间如何呈现——见 [proposed/2026-09-08-decision-space-presentation.md](proposed/2026-09-08-decision-space-presentation.md)。
- **下一步**：C2——基于已可运行的 web surface 做「带依据的候选决策」工具。

## 决策记录

| 记录 | 状态 | 说明 |
| --- | --- | --- |
| [proposed/2026-09-08-responsibility-allocation.md](proposed/2026-09-08-responsibility-allocation.md) | proposed | 责任分配：AI 有界认知 / 人意图·判断·校验 / harness 账本 |
| [proposed/2026-09-08-epistemic-loop-decision-unit.md](proposed/2026-09-08-epistemic-loop-decision-unit.md) | proposed | 认识论循环 + 决策交付单元 |
| [proposed/2026-09-08-decision-space-presentation.md](proposed/2026-09-08-decision-space-presentation.md) | proposed | 决策空间如何呈现（立身之本，开放） |
| [accepted/2026-09-08-dev-environment-worktrees.md](accepted/2026-09-08-dev-environment-worktrees.md) | accepted | 开发环境自指稳定性：bare 仓库 + worktree 蓝绿冻结 |
| [accepted/2026-09-08-first-increment-c1.md](accepted/2026-09-08-first-increment-c1.md) | accepted | 第一个增量 = C1：最小可运行的 prac-on-DSH |
| [accepted/2026-09-08-c1-build-prac-web-app.md](accepted/2026-09-08-c1-build-prac-web-app.md) | accepted | C1 怎么搭 + 验证结果：prac-web-app bundle + profile，独立消费者扩展 DSH 得证 |

## 参考

- 稳定说明（现在时）：[docs/](../../docs/)
