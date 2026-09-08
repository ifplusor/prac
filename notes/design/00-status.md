# 当前状态

## 阶段

设计探索。我们正在把「责任分配 + AI 能力」这套框架写清楚，尚未开始实际挂载到 DSH。

## 已经确立的

1. **定位**：Prac 是 DSH 的深度定制消费者。DSH 是全插件、可插拔的 agent harness，扩展点（bundle/profile/plugin）正是我们要的通用骨架。
2. **两个轴**：责任分配（responsibility allocation）+ AI 能力（capability）。
3. **主模型**：认识论循环（决定 → 验证 → 重审），而非生产线。
4. **交付单元**：agent 交「决策」，人交「承诺」；责任永远在人，harness 让责任感可行使而非可甩脱。
5. **真假天花板**：区分「AI 做不到」是模型上限还是 rig 缺口。

详见 [01-responsibility-and-capability.md](01-responsibility-and-capability.md) 与 [02-epistemic-loop-and-decision-unit.md](02-epistemic-loop-and-decision-unit.md)。

## 未解决的关键问题

- 如何让 agent **呈现一个待裁决的决策空间**（而不是直接坍缩成改文件）？
- 人用什么直觉去**辨别一个候选决策是否该被采纳**？——这是工具的立身之本。
- 校验姿态：机械 vs 判断的边界划在哪。
- 外置状态 vs 流程流畅的平衡点。
- 决策点/打断如何设计得「对的分歧、对的时机」。

见 [03-open-questions.md](03-open-questions.md)。

## 下一步

1. 深入「决策空间呈现」与「候选决策的采纳判据」——先把这个立身之本想清楚。
2. 在 DSH 上做一个可跑的最小实验，验证某个具体机制（见 [04-shape-on-dsh.md](04-shape-on-dsh.md)）。
3. 用真实的 vibe coding 任务驱动设计：记录一次真实的「大目标 → 拆解 → 审查 → 调整」过程，看哪里最痛。
