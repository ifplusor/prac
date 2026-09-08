# 笔记索引

Prac 的跨会话记忆，分两个部分：

## 理论基础（foundation）

> 把 LLM 的固有限制逐条推导成架构需求，是本项目的根理论。**先读这里。**

| 笔记 | 内容 |
| --- | --- |
| [foundation/agent_foundations.md](foundation/agent_foundations.md) | LLM 固有特征、核心隐喻、架构推论 |
| [foundation/memory_architecture.md](foundation/memory_architecture.md) | 三层记忆模型、RAG 检索、适应性遗忘 |
| [foundation/dual_agent_architecture.md](foundation/dual_agent_architecture.md) | Secretary/Executor 双角色架构 |
| [foundation/agent_design_guide.md](foundation/agent_design_guide.md) | 设计模式、人机协作边界、反模式 |

## 设计探索（design）

> 本项目围绕「责任分配 + AI 能力」两轴展开，以「认识论循环」为主模型。**按顺序读。**

| 笔记 | 内容 |
| --- | --- |
| [design/00-status.md](design/00-status.md) | 当前状态与下一步 |
| [design/01-responsibility-and-capability.md](design/01-responsibility-and-capability.md) | 责任分配 + AI 能力两个轴 |
| [design/02-epistemic-loop-and-decision-unit.md](design/02-epistemic-loop-and-decision-unit.md) | 认识论循环 + 决策交付单元 |
| [design/03-open-questions.md](design/03-open-questions.md) | 尚未解决的设计问题 |
| [design/04-shape-on-dsh.md](design/04-shape-on-dsh.md) | 如何映射到 DSH 的 bundle/profile/plugin |
