# Prac

Prac（Practice）是**前沿探索性工程实践**，研究通用 Agent 的能力边界与实现技术。Prac 建立在 [deepseek-harness](https://github.com/deepseek-harness)（DSH）之上。

> Prac 把「Agent 的形态」组织在两个轴——**责任分配** 与 **AI 能力**——并以**认识论循环**（决定 → 验证 → 重审）为主工作模型。**完整论述（现在时）见 [docs/philosophy.md](docs/philosophy.md)；每个「为什么 + 放弃了什么」见 [.agents/notes/](.agents/notes/)。**

## 为什么建立在 DSH 之上

DSH 是一个**全插件、可插拔**的 agent harness：每个部分（模型适配、工具注册、session 日志、agent-loop）都是一个插件，没有需要 `patch` 的特权核心。扩展它的方式是**在其旁挂载插件**，通过 `dsh.bundle`、`dsh.profile`、`cordis.patch.yml` 组合。

这正是 Prac 想要的通用 agent 骨架——它已经存在，而且造得很彻底。所以 Prac 的定位是：**DSH 的一个深度定制消费者**，把 agent 理念以最省力的方式嫁接到 DSH 的扩展点上。

## 核心主张（简述）

- **责任分配**：AI 只做有界认知；人负责意图 / 高杠杆判断 / 真实校验；harness 负责可核实的事实账户。
- **AI 能力**：区分「真天花板」与「假天花板」（后者是 rig 缺了东西，是我们要修的机会）。
- **认识论循环**：决定 → 验证 → 重审，而不是计划 → 执行 → 交付。
- **决策单元**：agent 交付「决策」，人交付「承诺」；责任永远在人，harness 让责任**可行使**而非可甩脱。

进一步论述见 [docs/philosophy.md](docs/philosophy.md)。

## 目录结构

```
docs/                       # 参考：理念（现在时）+ 目标架构（面向目标的设计）
  philosophy.md             #   两个轴 + 认识论循环 + 决策单元
  architecture.md           #   目标架构：prac 要成为什么（不是实现现状）
  dsh.md                    #   被依赖的系统之一：DSH 的内部结构
  vscode.md                 #   被依赖的系统之一：VS Code 的内部结构
  theory/                   #   继承的 LLM 限制理论（固有特征、记忆模型、双 Agent、设计模式）
.agents/notes/              # 决策记忆：agent 面向，状态轴（proposed/in-progress/resolved:<fine>/abandoned:<fine>，no-index）
  resolved/                 #   已定方向（决策定案/结论成立/代码实现且验证）
  proposed/                 #   正在论证的决策记录（date-slug 命名，无顺序编号）
  in-progress/              #   已接受、工作进行中
  abandoned/                #   被否 / 被更新取代 / 冻结
```

## 相关

- 决策记忆与当前方向：见 [.agents/notes/](.agents/notes/)（权威「当前状态」由 `in-progress ∪ resolved:*` 从树推导，不在 README 维护）。
- DSH 源码与文档：`../deepseek-harness/`
