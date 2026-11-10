---
status: in-progress
---

# Product design — vision, users, jobs, scope, metrics

> 产品设计 L0；体验见 [product experience](./2026-11-05-product-experience.md)；MVP / 验收见 [product-mvp](./2026-11-05-product-mvp.md)。
> 本文只写产品：为谁、解决什么、做什么、不做什么、怎么算好；不写实现。
> 验收由 James 签字。

## 1. 愿景

prac 是 **James 自己的工作环境**：把“和 agent 打交道”与“自己干活的 IDE”放在同一个界面里，让上下文、控制权、责任都留在人手上。

不是“更聪明的 agent”，也不是“功能更多的 IDE”；是**顺手**：知道现在在做什么、能随手切、能验证、能回滚。

## 2. 问题

- **上下文 / 注意力**：大多数工具把“塞什么上下文”和“给什么工具”分开；真正影响手感的是前者。
- **控制权**：全自动与每步确认之间没有顺手的切换；人被迫一直盯。
- **责任**：工具让责任“可甩脱”，而不是“可行使”；验证是表演。
- **割裂**：chat、IDE、笔记、diff、终端散在不同工具里；人在它们之间搬运上下文。

prac 的回应：

- chat 就是通道；notes 就是工作区文件；IDE 就在旁边。
- **MVP 取舍**：自动注意力跟随太复杂，先由人摆布局；以后可重新评估。
- plan / review / approval 用已有能力组合，不新造流程对象。
- 证据 / 验证 / 回滚是一等公民。

## 3. 用户 / 角色

- **James**：唯一使用者与 owner；对结果、架构、手感负责。
- **agent**：DSH 的 agent；做有界认知，不做长期自持；通过 chat / tools / notes 工作。
- **来源生态**：VS Code 扩展、DSH 插件、语言服务器；MCP server 在 MVP 不接，later 再评估。

## 4. Jobs / 场景

| Job | 场景 |
|---|---|
| 开始一个项目 | 选 project folder → 工作台；chat / notes / IDE 就位 |
| 和 agent 一起做 | 对话、计划、改文件、跑工具、看结果 |
| 审阅 | changed-files → diff；checks；request changes；human edit |
| 自己干活 | 编辑、终端、SCM、搜索、问题、输出、设置 |
| 切换 | session / Space / project folder / window；回来恢复 |
| 长会话 | 任务在 Host 继续；离开再回来不丢上下文 |
| 扩展 | GitLens / 语言包 / 视图进入 prac；不成为第二套布局 |
| 离开 / 回来 | 不要求人一直盯；状态可见 |

MVP 第一天承诺 P1–P4 覆盖的 4 个 job（开始 / 一起做 / 审阅 / 自己干活）；切换 / 长会话 / 扩展 / 回来按 P5–P9 的验收推进。

## 5. 产品需求

> 这里只放**产品级结果**。技术约束（DSH 主干、VS Code 两半、通信层、no fork、三层、LSP、MCP、XDG、no third-party）不是产品需求，见 [tech-architecture](./2026-11-05-tech-architecture.md)。

| # | 产品需求 | 产品响应 |
|---|---|---|
| P1 | 一个工作台：chat / notes / IDE 在同一界面 | 不来回切工具 |
| P2 | 共享工作区；chat 是通道；notes 是文件 | 人和 agent 读写同一份；不另做文档系统 |
| P3 | 布局：主操作台居中、辅助面板四周、可 split / terminal / 收起 | 人摆布局；MVP 不做自动注意力跟随 |
| P4 | 完整 IDE 能力 + 扩展生态，不要 VS Code 布局 | IDE 能力进 prac 的 window / board；布局是 prac 的 |
| P5 | 切换 / 恢复：session / Space / project folder / window | 离开再回来不丢上下文 |
| P6 | plan / review / approval 用已有能力 | note / diff / chat / ui-approval；不新造流程对象 |
| P7 | 可验证 / 可回滚 | 证据 / 验证 / revert 是一等公民 |
| P8 | 本地 / 可信 | XDG；无 telemetry；secret 不暴露 |
| P9 | 扩展生态：GitLens / language packs / views | 扩展内容进 prac；不成为第二套布局 |

**分界**：产品需求 = 用户可见的结果；实现方式 / 技术约束归 tech-*。

## 6. 能力地图

- **UI**：app / window / widget board / widget；Space；dock / sidebar / panel；tab strip；overlay。
- **IDE**：editor / diff、terminal、SCM、search、problems、output、settings；debug / tasks 以后。
- **agent（继承 DSH）**：conversation / session、plan、review、approval、artifacts、background；prac 只做呈现与入口。
- **扩展**：GitLens、语言包、视图、命令、状态、webview。
- **质量**：安全、日志、性能、a11y、i18n、测试、部署——用户可见的部分。

### 6.5 质量期望

- **安全**：trust 可见；secret 不进 UI；webview 不加载未知源。
- **可观测**：失败可见；没有 telemetry；日志可查。
- **性能**：切换 / 布局 / review 不拖沓；有预算。
- **a11y / i18n**：键盘可用；language pack / locale；文案不显示 key。
- **测试 / 部署**：更新不破坏 workspace；可回滚。

## 7. Non-goals

- 不做多用户 / 托管 / 登录；自用形态。
- 不做第二套文档系统；白板是文件。
- 不做 VS Code 的布局；只用它的内容 / 能力。
- 不做 plan application / review application / checkpoint / takeover 对象。
- 不给 agent 加它没有的能力；接口不够时记录，不偷偷扩。

### 7.1 MVP 取舍 / 暂缓

这些不是永久 non-goal，是 MVP 的取舍：

- **自动注意力跟随**：复杂度太高，MVP 不做；先由人摆布局；以后可评估。
- **MCP**：MVP 不做；later 再评估。
- **返回栈**：MVP 不做；active + recall 足够。
- **多窗口 / free window**：MVP 不做；以后重新裁决。
- **完整 i18n**：MVP 先单语 / 双语；later。

## 8. 指标

不是功能数，而是手感 / 控制权 / 上下文 / 验证：

- 从打开到第一次有用动作的时间；
- 切 session / Space / window 是否顺手；
- review 一个 turn 的 diff / checks 是否清楚；
- 离开再回来是否恢复上下文；
- 出问题时能否定位 / 回滚；
- 人是否能在“全自动”和“每步确认”之间自在切换；
- 主观摩擦：是否要照顾机器。

> **验收**：先按上面 7 条定性；量化在第一次 dogfood 后补 2–3 个可测数。

## Related

- [product experience](./2026-11-05-product-experience.md)：体验 / 交互。
- [product-mvp](./2026-11-05-product-mvp.md)：stories / MVP / 验收。
