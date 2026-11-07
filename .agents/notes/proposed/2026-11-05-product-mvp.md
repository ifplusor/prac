---
status: proposed
---

# product MVP — 产品模型、stories 与验收

> 上位模型：[product design](./2026-11-05-product-design.md) / [product experience](./2026-11-05-product-experience.md)。

> 本文只写**产品模型、stories、MVP 与验收**；本文的 **board** 是 **widget board** 的简称。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：prac 作为产品的当前模型；first launch → daily work 的 user stories；MVP must / should / later；验收口径。

**不在本 note**：

- UI 技术对象 / WM / frame → [tech-ui](./2026-11-05-tech-ui.md)；
- widget 拖拽 / dock / reset → [tech-widget](./2026-11-05-tech-widget.md)；
- extension / adaptor → [tech-extension](./2026-11-05-tech-extension.md)。

> **约定**：“不在本 note”表示由其他 note / 系统拥有，不等于产品不做。

**验收状态**：产品方向是当前设计；stories / MVP 未验收；由 James 签字。

## 2. 产品模型

- **project folder 是根**：文件、notes、git、conversation、后台服务、Space 都挂在它上面。
- **Space**：stage 的虚拟桌面；默认一个，按需创建；同一 project folder / conversation / 文件可以出现在不同 Space；Space 按 project folder 存储。
- **panel / dock**：frame 级，不随 Space 切换；只有 stage 跟 Space。
- **WM / window**：app 打开 window；window 是显示实体；window manager 管 placement / group / geometry / active；board window 是 content 为 board 的 window。
- **widget board / widget**：widget board（board）是 widget 的容器；board 不是 window / app；widget 是可组合内容；board 通过 board window 显示。
- **chat / IDE**：chat 是 DSH 会话；IDE 是编辑器 / 资源 / SCM / 搜索 / 终端等；两者都在 prac 的 UI 里，但不互相替换。
- **plan 是 note**：人和 agent 共编；不新增 plan application。
- **review 是 diff / chat**：changed-files card → diff；checks 是 shell / tool calls；request changes 是 chat；approve 不是新对象；human edit / git revert。
- **changed-files card（S4）**：DSH `conversation.chat.turnTail` 内部 slot 的 widget；读 turn 的 `workspace/changes` summary；点文件在 editor group 打开 turn-scoped **preview** diff；只显示最新 turn；binary / oversized 禁用；checks 留在 chat / tool calls，card 不加 review 动作。
  - 数据来源：DSH `workspaceChanges.summary()` + Host 的 turn-diff reader；reader 依赖 DSH 私有 snapshot 布局，布局变时回退 recorder。
- **tool approval**：ui-approval 内置在 chat / tool call；cancel / status 只呈现 DSH 支持的；不做第二套审批状态。
- **a11y / keyboard**：至少 Tab 能进 widget root、focus 可见、快捷键可执行；细节见 [product experience](./2026-11-05-product-experience.md) §8。
- **不新增**：plan application / review application / checkpoint / takeover 对象。
- **布局是人摆的**：主操作台居中、辅助面板四周；可 split、terminal、收起；**MVP 不做自动注意力跟随**（复杂度高，later 评估）。
- **tile mode 是当前唯一模式**；free window 当前不考虑。

## 3. Stories

| # | 场景 | 产品判据 |
|---|---|---|
| S0 | 第一次打开，没有 project folder | 只有 project folder 选择（最近 / 打开文件夹 / 空状态）；没有工作台 |
| S1 | 打开第一个 project folder | 工作台：title bar / Explorer / notes / git / chat / 默认 Space |
| S2 | 第一个 conversation / plan | plan 写成 note；人和 agent 共编；chat 讨论；editor 编辑；没有 plan application |
| S3 | 第一次打开文件 | 当前 window group 新增 / select editor window（一个文件）；chat 是同一 group 的另一个 window；split 才产生第二个 group；active window |
| S4 | 第一次 review | changed-files card → diff；checks；chat；human edit；git revert；没有 review application / checkpoint |
| S5 | 第一次独立工作 | 默认 window group；select editor window；chat 可收进 panel / 后台；agent 不抢主位 |
| S6 | 第一次新建 / 切换 Space | title bar 的 Space 切换（`1` / `+`）→ 新建 Space（初始一个 group）→ 摆 group / windows → 切回；同一 conversation / 文件跨 Space；状态恢复 |
| S7 | 第一次失败 | error / status；cancel（DSH 支持时）；human edit；git revert；不发明 checkpoint |
| S8 | 第一次插件 | GitLens 出现在 sidebar / panel；VS Code view / board / widget；与 project folder 联动 |
| S9 | 第一次切 project folder | 文件 / notes / git / conversation / 后台服务 / Space 全换；切回旧 folder 恢复那套 Space |
| S10 | 离开后回来 | 回到上次 project folder / conversation / Space；看到后台服务状态 |
| S11 | 窄屏 / 键盘 | 768 drawer；快捷键；focus order |

## 4. MVP

**Must**：

- S0 / S1：first-run + project folder；
- S2：conversation / chat / plan note（smoke test）；
- S3 / S5：editor window / active window / 默认 window group；
- S4 / S7：diff / checks / human edit / git；ui-approval；DSH 支持的 status / cancel；
- S6：Space 默认一个 + 按需创建 + 切换 + 状态。

**Should**：

- S5：chat 收起 / panel；后台服务状态；
- S8：GitLens / VS Code view；
- S11：768 / 快捷键 / focus order。

**Later**：

- application 产品化（pin / launcher / default placement）；
- 多窗口 / 多标签页；
- Reset All Locations；
- 更多内建扩展 / 扩展策略自动化；
- 自动注意力跟随（复杂度高；MVP 不做）；
- MCP（MVP 不做；later 评估）。

**Not considered**：

- free window / OS-like 浮动窗口；进入路线图需要重新裁决。
- 注意：**window group 内的 split 是核心**，不属于“free window”。

## 5. Acceptance

- S0：没有 project folder 时只有选择入口；选完才有工作台。
- S1 / S9：project folder 切换后文件 / conversation / 后台服务 / Space 跟着换；切回恢复。
- S2 / S3：first prompt、plan note、文件 active window、chat is inactive（或同一 group 的另一 window）。
- S4 / S7：diff / checks / note 机制 / ui-approval / human edit / git revert；只呈现 DSH 支持的 status / cancel；changed-files card 出现 / 点文件开 preview diff / 非最新不显示 / binary 禁用；approval 只在 tool call 出现。
- S6：默认一个 + 按需创建 / 切换；同一 conversation / 文件跨 Space；每个 Space 的 window group / active window 状态保留；panel / dock 是 frame 级，不随 Space；后台服务后台继续。
- S5：默认 window group；chat 收起；后台服务状态。
- S8：GitLens 在 sidebar / panel；widget 可在 board 之间移动；widget 不成为 tab。
- S11：768、快捷键、drawer、focus order。
- 全局：无 console error；project folder / card / diff / GitLens 不回退；MVP 布局人摆，自动注意力跟随为 later。
- **Gate**：changed-files 为 planned；first-run / approval / review 先按产品验收，不全是 live gate。

## 6. Open questions

1. **First-run / project folder**：最近 / 打开文件夹 / 空状态的具体入口；切换过渡。
   - 关闭条件：一条 first-run 验收。
2. **Panel 默认**：左 Explorer 开、右收、bottom 收；auto-hide；768 drawer。
   - 关闭条件：默认布局定稿 + 一条 768 验收。
3. **Note 共编**：可见性 / 冲突 / 版本。
   - 关闭条件：定冲突策略 + 一条验证。
4. **Chat 收起 / 恢复**：关闭后如何恢复；通知强度。
   - 关闭条件：一条收起 / 恢复验收。
5. **Application 产品化**：pin / launcher / default placement；哪些进 MVP。
   - 关闭条件：定产品化范围 + 一条验收。
6. **Space 状态作用域**：window group / active window 的具体保留范围；panel / dock 是 frame 级（已定）。
   - 关闭条件：定作用域 + 一条切回验收。
7. **多窗口 / 多标签页**：当前搁置；重新进入需要裁决。
   - 关闭条件：重新裁决。
8. **Review 约定**：checks 的呈现；request changes 的入口；diff 的默认打开方式（当前设计是 preview）。
   - 关闭条件：一条 review 验收。

## Related

- [product design](./2026-11-05-product-design.md)：愿景 / 用户 / 场景 / 指标。
- [product experience](./2026-11-05-product-experience.md)：工作台 / IDE / agent 体验。
- [docs/ui-acceptance.md](../../../docs/ui-acceptance.md)：验收参考。
