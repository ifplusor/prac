# Prac 在 DSH 上的落地结构

> Prac 以 DSH 消费者的身份，把「认识论 harness」的六件事嫁接到它的扩展点上，而不是改它的内核。这是现在时的结构参考；「为什么这么定」见 [.agents/notes/](../.agents/notes/)。

## DSH 的扩展模型（已核实的结构）

- **一切皆插件**：模型适配、工具注册、session 日志、agent-loop 都是插件，**没有需要 patch 的特权核心**。扩展 = 在别的插件旁边挂载一个插件。
- **Profile**：命名组合，存在 Harness home。列出它叠的 bundle、持有的 out-of-tree 插件、以及用户自己的 `cordis.patch.yml`。有 `web`、`headless`、`sdk`、`sdk-minimal`、`acp` 等模板。
- **Bundle**：Cordis 配置行 + 它们挂载的代码的**分发格式**。`package.json` 通过 `dsh` 字段声明：`dsh.profile` 列 profile 的 bundles，`dsh.bundle` 指向 bundle 的 patch 文件。
- **分层顺序**：每个 profile 列出的 bundle 按序、然后是 profile 的 `cordis.patch.yml`、再是 home 级的、最后是 `--patch` overlay。patch 按 id 定位一行并整体替换它的 config，或插入新行。
- **`dsh-base`** 是 `web`/`headless`/`sdk`/`acp` 共享的第一层（模型适配、工具、持久化、沙箱与审批策略、设置、凭据、遥测）；`dsh-web-app` 再加浏览器应用。
- 自定义 profile **默认可热重载**；shipped `web` 是 live 的。`dsh --profile web` 是 `dsh web` 的别名。
- Web GUI 从 `../deepseek-harness/` 构建（本会话当前就在用它）。
- **Model-visible ⟺ logged**：任何到达模型请求的东西都必须能从 session log 重建；新模型可见输入需要新 session event 并扩展 `SessionEventMap`。

## prac 作为消费者怎么接

```
profile: prac
  ├── dsh-base                 (共享第一层：模型、工具、持久化、审批、设置、凭据)
  ├── dsh-web-app              (浏览器应用，观测面)
  ├── prac-decision            (决策空间工具 + 依据一等公民渲染)   ← 自定义 bundle
  ├── prac-review              (审查为主界面：候选裁决呈现)        ← 自定义 bundle
  ├── prac-memory              (架构记忆：活的决策历史文档)        ← 自定义 bundle
  ├── prac-plan                (活的计划：可被现实证据打击的假设)  ← 自定义 bundle
  └── cordis.patch.yml         (本项目对行为的调优)
```

每个 `prac-*` 是两个东西：一组 **Cordis 配置行** + 它们挂载的**插件代码**。它们只做三件事：**注册工具、注册上下文注入、注册交互/呈现**。这正是 DSH 钦定的扩展缝，几乎不需要碰 agent-loop。

## 六件事如何落到机制上

| 六件事 | 落在 DSH 的什么上 |
| --- | --- |
| **决策优先** | 一个「决策空间」工具：输入大目标 ← 输出结构化候选集合，不直接改文件。 |
| **依据是一等公民** | 决策/依据作为**模型可见的输入** → 需要新 session event（扩展 `SessionEventMap`），logs 可重建。 |
| **可逆带检查点** | 基于 DSH 的会话/持久化，把每个候选决策/工作单元做成可部分采纳、可回滚的快照。 |
| **审查是主界面** | 交互/呈现插件（DSH 的 approval/interaction 能力），把「审决策」做成常态，而非审 diff。 |
| **架构记忆** | 基于 context/settings/session 插件，维护一份系统决策史（活的架构文档），始终注入 agent 的上下文。 |
| **活的计划** | 计划作为可被重审的假设对象；重审计划是一等操作（一个被现实证据打击后触发的重规划工具）。 |

## 一个需要正视的张力

AGENTS.md 的规则：**「Plugins, not loop changes——新行为走文档化的扩展点；改 agent-loop 需要更新 docs/architecture.md。」**

好消息是：认识论循环**未必需要改 DSH 的 agent-loop**。DSH 的 loop 本身就是一个「轮次/步骤」的循环；认识论行为是关于「这个循环里用什么工具、装什么上下文、怎么呈现」的——这些都能做成工具 + 上下文插件 + 交互插件，留在循环内部。只有当你想要的是**根本不同的轮次结构**（比如「先出决策让你裁决，再执行」的显式两阶段），才需要更深改动。

所以**第一原则**：尽量以一个纯消费者的身份，把六件事都塞进 DSH 现有循环的扩展点里。只有当某个机制确实需要驱动循环结构本身，才考虑更深的介入，且要显式记录。

## 落地路径（探索）

1. 从最痛的一处切入：拿一个真实的 vibe coding 任务（大目标 → 拆解 → 审查 → 调整），看「决策空间呈现」和「审查主界面」这两件事哪一处最阻碍你。
2. 做一个**最小 DSH 实验**：自定义 profile + 一个 bundle，只验证一个机制（比如「带依据的候选决策工具」），在 Web GUI 里观察。
3. 把每次实验的观察写进 `.agents/notes/`（新的 proposed 记录，或更新 decision-space-presentation）。

## 相关

- [proposed/2026-09-08-epistemic-loop-decision-unit.md](../.agents/notes/proposed/2026-09-08-epistemic-loop-decision-unit.md)
- [philosophy.md](philosophy.md)
- DSH：`../deepseek-harness/docs/architecture.md`（profiles & bundles）、`packages/boot/app-boot`、`packages/bundle/`
