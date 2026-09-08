# Prac

Prac（Practice）是**前沿探索性工程实践**，研究通用 Agent 的能力边界与实现技术。这个名字和它的理论基础继承自早期的 Python 原型（已归档于 `../prac-legacy-python/`），但**实现完全重建**在 [deepseek-harness](https://github.com/deepseek-harness)（DSH）之上。

> 继承的是**理念与笔记**，不是旧代码。旧 `prac` 的根本资产是 [notes/foundation/](notes/foundation/)，它把 LLM 的固有限制逐条推导成架构需求；新项目的核心思考记录在 [notes/design/](notes/design/)。

## 为什么要重建而不是继续

旧 `prac` 是一个自研的 Python agent 脚手架，用来验证「Agent 的能力边界」这套理论。它验证出了思想，但实现本身是一个封闭的原型：从零写工具系统、记忆系统、任务队列、TUI，每一样都是重复造轮子。

DSH 是一个**全插件、可插拔**的 agent harness：每个部分（模型适配、工具注册、session 日志、agent-loop）都是一个插件，没有需要 `patch` 的特权核心。扩展它的方式是**在其旁挂载插件**，通过 `dsh.bundle`、`dsh.profile`、`cordis.patch.yml` 组合。这正是旧 `prac` 想要的「通用 agent 骨架」——已经有人造好了，而且造得很彻底。

所以新 `prac` 的定位是：**DSH 的一个深度定制消费者**，把从旧 `prac` 继承的 agent 理念，以最省力的方式嫁接到 DSH 的扩展点上。

## 核心理念

新 `prac` 把「Agent 的形态」重新组织在两个轴上：

### 1. 责任分配（Responsibility Allocation）

主流 harness 的隐含分工是「人 = 定目标 + 全程监督 + 判对错；AI = 稳定执行」——这让人和 AI 各自接到自己最不擅长的活。新 `prac` 的重排：

- **AI 只负责有界认知**：感知当下、提出选项、生成、做局部转换。每个都是可验证的短单元。
- **人负责意图 + 高杠杆处的判断 + 真实校验**，只在值得介入的决策点出现。
- **harness 负责账本**：维护外部、持久、可核实的事实账户，**不信任模型的自我报告**。

### 2. AI 能力（Capability）

把「AI 做不到 X」区分为两类：

- **真天花板**：当前模型确实做不到。
- **假天花板**：其实是这套 rig 没让模型触碰到它够得着的东西（缺工具、缺上下文、缺权限）——实践中绝大多数属于这类。

新 `prac` 的价值之一，是系统地去猎假天花板，并把真天花板测准。

## 工作模型：认识论循环

软件开发是创造性工作，不是重复事务。工作机制是「边做边想、不断调整」，很难一开始把所有东西想清楚。

因此新 `prac` 以**认识论循环**为主模型，而非以「计划 → 执行 → 交付」的生产线为主模型：

```
决定 → 验证 → 重审（重审会触发新的思考）
```

在这个循环里：

- **agent 的交付单元是「决策」，不是「代码」**：它交出来的是「有几个选项、各自代价、我推荐哪个、我打算怎么验证」，代码只是副产品。
- **你的交付单元是「承诺」**：把候选决策变成承诺的那份判断，以及系统的结构。
- **责任永远在人**——软件是对世界（和对未来维护者）的承诺，agent 担不起。但 harness 的职责不是让责任变得可甩脱，而是**让「你的责任」变得可行使**：把 agent 的推理暴露、可验证、可回滚。

详见 [notes/design/02-epistemic-loop-and-decision-unit.md](notes/design/02-epistemic-loop-and-decision-unit.md)。

## 目录结构

```
notes/
  foundation/          # 继承自旧 Python prac 的理论基础（LLM 限制 → 推导 → 架构）
    agent_foundations.md        LLM 固有特征与限制、核心隐喻、架构推论
    memory_architecture.md      三层记忆模型、RAG 检索、适应性遗忘
    dual_agent_architecture.md  Secretary/Executor 双角色架构
    agent_design_guide.md       设计模式、人机协作边界、反模式
    development_practices.md    旧项目的开发实践（留作参考）
    task_panel_feature.md       旧项目的 TUI 任务面板（留作参考）
  design/              # 新项目的设计探索（正在进行的思考）
    00-status.md               当前状态与下一步
    01-responsibility-and-capability.md  责任分配 + AI 能力轴
    02-epistemic-loop-and-decision-unit.md  认识论循环 + 决策单元
    03-open-questions.md      尚未解决的设计问题
    04-shape-on-dsh.md        如何映射到 DSH 的 bundle/profile/plugin
```

## 当前状态

- **阶段**：设计探索。正在把「责任分配 + 认识论循环」这套框架写清楚，尚未开始实际挂载到 DSH。
- **下一步**：见 [notes/design/00-status.md](notes/design/00-status.md)。

## 相关

- 旧 Python 原型归档：`../prac-legacy-python/`
- DSH 源码与文档：`../deepseek-harness/`
