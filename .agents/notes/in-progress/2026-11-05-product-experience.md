---
status: in-progress
---

# Product experience — layout, IDE, agent, navigation

> 产品设计 L1；愿景 / 范围见 [product design](./2026-11-05-product-design.md)；stories / 验收见 [product-mvp](./2026-11-05-product-mvp.md)。
> 本文写用户看到 / 用到的行为；不写实现。
> 验收由 James 签字。

## 1. 体验原则

- **一个工作台**：chat / notes / IDE 在同一个界面；不来回切工具。
- **人摆布局**：谁在中间、谁在侧边由人决定；MVP 不做自动注意力跟随（复杂度高），以后可评估。
- **chat 是通道**：异步、松耦合；不要求人一直盯。
- **review 是 diff / chat**：changed-files → diff；checks / request changes 在 chat。
- **可回到刚才**：active window / recall；MVP 不做返回栈。
- **失败可见**：空 / 错 / loading 都有明确状态；不静默。

## 2. 工作台

- **title bar**：project folder / session / Space 的导航入口。
- **tab / window**：一个 folder 一个 tab；多显示器 = 多个 tab / 窗口；同一个 folder 已有 tab 时聚焦它，不再开第二个；session / Space 在 tab 内切换。
- **stage**：主操作台；可 split / grid；中间放什么由人决定。
- **dock rail**：工具 / board 的入口；点图标切 board，不抢 stage。
- **sidebar / panel**：frame 级，不随 Space；放 Explorer / SCM / search / problems / output 等。
- **window group**：一个 region 里多个 window，只有一个可见；tab strip 列出 window。
- **board**：widget 的容器；board window 显示 board；widget 可拖到兼容 board。
- **Space**：stage 的虚拟桌面；切换只切 stage；sidebar / panel / dock 不变。

## 3. 第一次 / 日常

### 3.1 第一次

- 没有 project folder → 只有选择入口（最近 / 打开文件夹 / 空状态）。
- 选完 → 工作台：title bar / Explorer / notes / git / chat / 默认 Space。
- 默认 layout：主操作台居中；一侧 chat；一侧 Explorer；panel 收起。
- 不要求用户先配置；默认可用。

### 3.2 日常

- 打开 project folder → 恢复上次 session / Space / window 与 active；scroll 位置 later。
- chat 与 IDE 并排；文件在 editor window；终端随时能调出。
- notes 是文件；plan 在 note 里；不新开 plan app。
- 改完 → changed-files card → diff；checks 在 chat；request changes 是 chat。
- 离开页面 → 任务在 Host 上继续（与前端是否打开无关）；回来看到状态。

## 4. IDE 体验

- **editor / diff**：tab / group / split；preview / permanent；breadcrumbs 属于 editor window。
- **terminal**：随时调出；输入 / resize / 关闭；人用 terminal 与 agent terminal 分开。
- **SCM / git**：状态 / diff / stage / commit；GitLens 的 view 进 board。
- **search**：搜索 / 结果 / 打开 / replace。
- **problems**：诊断列表 / 跳转；只读。
- **output**：channel / 日志；不作为 telemetry。
- **settings / keybindings**：在 editor window 打开；作用域 / 搜索 / 修改。
- **debug / tasks**：以后；MVP 不承诺。

## 5. agent 体验

Agent 的循环、turn / session 生命周期、完成与后台执行、approval 都继承 DSH；本节只写 prac 呈现什么、从哪里进入，不重新定义 agent 行为。

- **chat**：呈现 DSH conversation；一个 conversation 一个窗口（prac 的窗口策略）；chat 是通道。
- **session**：title bar 切换 DSH session；恢复用 DSH 的 session 状态；前端关闭不打断（Host 继续）。
- **plan**：note 文件；人和 agent 共编；不新增 plan app / plan mode。
- **note 共编**：MVP 按普通文件；agent 编辑前重读最新；人改过的文件被覆盖时在 chat 可见提示；不做实时协作 / 锁 / 版本向量。
- **review**：DSH 记录每轮的 changed files；prac 的卡就是 DSH 的卡（hover 预览、四行折叠、逐轮历史）；点文件在 editor group 打开 turn-scoped diff；binary / oversized 禁用。
- **checks**：shell / tool calls 的结果留在 chat / tool call；card 不列 checks。
- **request changes**：chat message；approve 不是对象。
- **approval**：DSH ui-approval；tool call 里 allow / reject；只呈现 DSH 支持的 status / cancel。
- **human edit / git revert**：直接在 editor / git；不新造 checkpoint。
- **background**：执行归 DSH 的 Host；prac 只呈现 run 状态（title bar / chat / session 列表）并提供回到对应 session 的入口；不做 background 面板。

## 6. 导航 / 注意力

- **active window**：一个 group 一个 active；tab 点击切换。
- **recall**：找回隐藏 / 放走的 window / board。
- **MVP 先不自动布局**：不按“交流 / 审方案 / 审工件”切中间；自动跟随是 later，不是永久约束。
- **返回栈**：MVP 不做；active + recall 足够；以后若需要，再作为 workbench chrome。
- **Space**：切 Space 只切 stage；sidebar / panel / dock 不随 Space。
- **project folder**：一个 folder 一个 tab；切换 = 打开/聚焦那个 folder 的 tab；同一个 folder 不重复开。

## 7. 状态 / 反馈

- **空**：没有 project folder / 没有 session / 没有 changed files / 没有 diff。
- **loading**：summary / diff / search / diagnostics；不阻塞 chat。
- **错**：行内 / card / overlay；错误码 + 简短文案；不暴露 stack / secret。
- **offline / 断线**：page 重连；不丢 session；状态可见。
- **通知**：应用级 overlay；不打断输入；可 dismiss。
- **focus**：键盘可达；Tab 进 widget root；focus 可见。

## 8. 可访问性 / i18n（体验层）

- 键盘完成主要操作；不只靠鼠标。
- 屏幕阅读器能读 window / tab / board / action。
- 对比度 / 主题跟随；不硬编码颜色。
- editor 用 VS Code language packs；chat 用 DSH locale；prac chrome 先单语 / 双语。
- 文案不显示 key；缺失 → 默认语言。

## 9. MVP 体验优先级

- **Must**：工作台 / project folder / chat / editor / diff / changed-files / notes / terminal / SCM / search / approval / settings。
- **Should**：problems / output / GitLens / Space / 多 session / recall。
- **Later**：debug / tasks / 返回栈 / 多窗口 / free window / 完整 i18n / 自动注意力跟随 / MCP。

### 9.1 体验指标

先定性；量化在第一次 dogfood 后补 2–3 个可测数（候选：切 session / 恢复 / review diff 的耗时与成功率）。

## Related

- [product design](./2026-11-05-product-design.md)：愿景 / 范围。
- [product-mvp](./2026-11-05-product-mvp.md)：stories / 验收。
