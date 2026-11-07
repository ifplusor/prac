---
status: abandoned:superseded
---

# UI — user stories（first launch → daily work）

这是 UI scheme note 的 **peer note**。UI scheme 的 **Space 是 prac 的核心概念、主线**；background service 侧只组合 DSH 已经支持的，保持简单。这份 note 从**第一次启动**和真实任务出发，验证这个方向。

Persona：James，资深工程师；prac 是真实工作环境；background service 有用但不可靠，需要人改计划、审查、接管；UI 服务于人；project folder 是根。

原则：

- **Space 是 core**：默认一个 Space；其他按需创建（像 macOS Spaces）；同一个 conversation / 文件可以出现在不同 Space。Space 按 project folder 存储（对齐 VS Code 的 workspace storage）。
- **Space 的 mode 是 tile**：free window 当前不考虑；进入路线图需重新裁决。
- **background service 侧简单**：只组合 DSH 支持的 conversation / chat / tool calls / status；plan 是 note（note 机制）；review 是 diff / chat；human edit / git / checks 是已有能力；plan mode 不是路径；tool approval 是 ui-approval 内置；不新增 plan application / review application / checkpoint / takeover 对象。

## Stories

### S0 — 第一次打开（没有 project folder）

- **Trigger**：第一次打开 prac 的 URL。
- **Steps**：打开页面 → 选 project folder（最近 / 打开文件夹）→ 进入工作台。
- **UI**：只有 project folder 选择（最近 / 打开文件夹 / 空状态）；没有 stage / chat / background service session。
- **Assumes**：project folder 是根；没有 project folder 就没有工作台。
- **Needs**：first-run；最近；打开文件夹；空状态。

### S1 — 打开第一个 project folder

- **Trigger**：选了 `prac-dev`。
- **Steps**：project folder 加载 → Explorer → conversation → 第一个 prompt → 默认 Space。
- **UI**：title bar；Explorer；file tree / notes / git；chat；background service；默认 Space。
- **Assumes**：project folder 作用域；conversation 属于 project folder；默认 Space。
- **Needs**：project folder 加载；Explorer；conversation；background service；默认 Space。

### S2 — 第一个 conversation / 第一个 plan

- **Trigger**：James 说「修一下这个失败的测试」。
- **Steps**：background service 读 project folder → 把 plan 写成一个 **note** → James 也可以在 editor 直接编辑（人和 background service 共编）→ chat 讨论 → background service 读 note / 执行。
- **UI**：chat；plan note（editor）；人和 background service 共编；tool calls；status。
- **Assumes**：plan 是 project folder note；人和 background service 共编；editor 是编辑面；plan mode 不是路径；background service 侧没有 plan application。
- **Needs**：conversation；chat；note；editor；共编；background service。

### S3 — 第一次打开文件

- **Trigger**：background service 说「看 `build_resume.py` 第 24 行」。
- **Steps**：点文件 → 在 window group 里新增 / select 一个 **editor window**（一个文件）；chat 是同一 window group 的另一个 window（single-instance）。再打开一个文件 → 同一 window group 的第二个 editor window tab；需要并排时 split 成两个 window group。
- **UI**：当前 window group 的 tab strip（file A / file B / chat / diff 等 windows）；active window = 一个 editor window；file tree；stage；split。
- **Assumes**：window group 是 windows 的容器；editor window = 一个文件；chat 是 single-instance window；window group 不感知内部视觉；editor group 不再是 prac 概念。
- **Needs**：window group 的 tab strip（windows）；editor 每个文件一个 window；chat；window switch；split；active window。

### S4 — 第一次 review

- **Trigger**：background service 改完，chat 的 turn tail 出现 changed-files card。
- **Steps**：点 card → diff（inactive window group / tab）→ changed files / checks → plan 是 note；code review 在 diff / chat；human 自己改 / git revert。
- **UI**：diff（inactive window group / tab）；changed files；checks；chat；human edit。
- **Review 约定**：changed-files card → diff window group；changed files 逐个打开；checks 是 shell / tool calls；chat 是讨论面（request changes 是 chat message；approve 不是新对象）；human edit；git revert；ui-approval 只为工具调用。
- **Assumes**：plan 是 note；code review 是 diff / chat；tool approval 是 ui-approval；takeover 是 human edit；revert 是 git；没有 review application / checkpoint 对象。
- **Needs**：card；diff；checks；chat；note；ui-approval；human edit；git。

### S5 — 第一次独立工作

- **Trigger**：James 不想让 background service 参与，自己改代码。
- **Steps**：在默认 window group 里 select 一个 editor window（一个文件）直接编辑；chat 仍是同一 window group 的另一个 window，或收进 panel / 后台。
- **UI**：默认 window group；editor window（一个文件）；chat window / panel；Explorer / SCM / GitLens。
- **S5 的默认 window group**：默认 Space 就带一个 window group；独立工作只需要 select editor window；chat 收起 / 后台是 Should。
- **Assumes**：默认 Space 1 个 window group；window group 里 editor / chat 都是 windows；editor 每个文件一个 window；chat 可以 select / 收；background service 不抢主位。
- **Needs**：默认 window group；editor windows；chat；chat 收起；background service 状态。

### S6 — 第一次按需新建 / 切换 Space

- **Trigger**：James 想把一个 task 分到另一个空间。
- **Steps**：title bar `1 | +` → 新建 Space（初始 1 个 window group）→ 命名 / 摆 window group / 往 window group 里加 windows（file / chat / diff…）→ 切回默认 Space。
- **UI**：Space switcher；新建；window group 排列；每个 window group 的 windows；同一 conversation / 文件跨 Space；tabs / active window / panel 状态恢复。
- **S6 的 mode**：默认 Space 是 tile mode；free window 当前不考虑（tile mode 是唯一模式）。
- **Assumes**：默认一个 Space / 一个 window group；按需创建；Space 的 mode 是 tile，free window 当前不考虑；Space 按 project folder 存储；window group 是 windows 的容器；editor window = 一个文件。
- **Needs**：Space switcher；add；window group 排列；windows；same conversation / files；state。

### S7 — 第一次失败

- **Trigger**：background service 跑错测试 / 改错文件 / 卡住。
- **Steps**：人看到 error / status → 在 chat / UI 里 cancel（如果 DSH 支持）→ 自己改文件 → git revert。
- **UI**：error / status；chat；human edit；git。
- **Assumes**：tool approval 是 ui-approval 内置；cancel / status 只呈现 DSH 支持的；takeover 是 human edit；revert 是 git；不发明 checkpoint。
- **Needs**：error / status；ui-approval；cancel（支持时）；human edit；git revert。

### S8 — 第一次插件

- **Trigger**：James 想用 GitLens 看 blame / history。
- **Steps**：GitLens 出现在左 sidebar / panel；点开；和 project folder 文件联动。
- **UI**：GitLens；VS Code view；sidebars / panels。
- **Assumes**：GitLens 是 widget board / widget；sidebars / panels；MVP 不新增完整 application registry。
- **Needs**：GitLens；VS Code view；sidebars / panels。

### S9 — 第一次切 project folder

- **Trigger**：从 `prac-dev` 切到另一个 project folder。
- **Steps**：project folder switcher → 文件 / notes / git / conversation / background service / Space 全部换；Space 按 project folder 存储，切回旧 project folder 时恢复那套 Space。
- **UI**：title bar；Explorer；conversation；background service；Space 集合。
- **Assumes**：project folder 是根；作用域；Space 按 project folder 存。
- **Needs**：project folder 切换；各作用域刷新；旧 Space 恢复。

### S10 — 第一次离开后回来

- **Trigger**：关掉页面 / 切到另一个 Space，过一段时间回来。
- **Steps**：打开 prac → 回到上次 project folder / conversation / Space → 看到 background service 状态。
- **UI**：恢复 project folder / conversation / Space；background service 状态。
- **Assumes**：持久化；background service 状态；不强制跳回 chat。
- **Needs**：持久化；恢复；background service 状态。

### S11 — 第一次窄屏 / 键盘

- **Trigger**：768 / 外接键盘。
- **Steps**：打开；切 project folder / conversation / Space；展开 / 收起 panel。
- **UI**：drawer；editor / chat；Space switcher；快捷键。
- **Assumes**：当前 responsive；panel；键盘。
- **Needs**：768；drawer；快捷键；focus order。

## 这些故事说明了什么

- **Project folder 是 first-run 的第一个问题**；S0 / S1 / S9 都先问 project folder；没有 project folder，没有工作台。
- **Space 是主线，但默认一个**：S6 是按需新建 / 切换；不是三个任务模式；Space 的 mode 是 tile，free window 当前不考虑；同一个 conversation / 文件跨 Space；切换 / 状态是核心。没有它，chat / review / 人的工作只能挤在一个 stage 上。
- **Window switch 是 stage 内的事**：文件打开 → 当前 window group 新增 / select 一个 editor window（一个文件）；看 chat → select chat window（同一 window group 或另一个 window group）；active window group + active window；不是按「有没有文件」猜；split 才是并排。
- **background service 侧简单**：S2 / S4 / S7 只需要 plan note（人和 background service 共编）、ui-approval、diff / chat、human edit、git、checks；不需要 plan application / review application / checkpoint / takeover 对象。
- **人的自由**：S5 的默认 window group / chat 收起；chat application 关闭 / panel / 后台；通知不抢焦点。
- **插件 / application**：S8 的 GitLens 是 widget board / widget；sidebars / panels；MVP 不需要完整 application registry（later）。

## Derived requirements

| # | Requirement | Stories | Priority |
| --- | --- | --- | --- |
| 1 | First-run project folder 选择 / 最近 / 打开文件夹 | S0 | Must |
| 2 | Project folder 作用域；切换后文件 / conversation / background service / Space 跟着换 | S1 / S9 | Must |
| 3 | Session；chat；turns；tool calls；status | S1 / S2 | Must |
| 4 | 文件打开 → active window = editor；chat is inactive | S3 | Must |
| 5 | Plan 是 project folder note（人和 background service 共编；editor；chat） | S2 | Must |
| 6 | Changed-files card；diff；checks；tool approval；diff / chat review | S4 | Must |
| 7 | Human edit；git revert | S4 / S7 | Must |
| 8 | **Space：默认一个 + 按需创建；切换；状态；同一 conversation / 文件** | S6 | **Must（主线）** |
| 9 | Chat 收起 / panel；background service 状态 | S5 / S7 | Should |
| 10 | 768 drawer；快捷键 | S11 | Should |
| 11 | GitLens / VS Code view 在 sidebars / panels | S8 | Should |
| 12 | Tool approval（ui-approval）；cancel / status（仅 DSH 支持时） | S7 | Should |
| 13 | application registry | — | Later |

自由 window / 任意 split 当前不考虑（进入路线图需重新裁决）。

## Assumptions under test

| Assumption | Tested by | Verdict | MVP? |
| --- | --- | --- | --- |
| Project folder 是根；first-run 先选 project folder | S0 / S1 / S9 | 成立 | 是 |
| **Space 是核心；同一个 conversation / 文件跨 Space** | S6 | 成立；是主线 | 是 |
| 文件打开 → active window = editor；chat is inactive | S3 | 成立；active window group | 是 |
| Plan 是 note；review 是 diff / chat | S2 / S4 | 成立；background service 侧不需要 plan application / review application | 是 |
| Human edit / git revert / checks 是已有能力 | S4 / S7 | 成立 | 是 |
| Chat 收起 / panel；默认 stage | S5 | 成立 | 是 |
| 自由 window / OS-like 窗口管理 | S3–S6 | free window 当前不考虑；application registry 仍可 later | 否（当前不考虑） |
| note 机制 / ui-approval 已内置；plan mode 不是路径；cancel / checkpoint 只做支持的 | S7 | 不发明；内置优先 | 部分 |

## MVP

**Must**：S0 / S1 / S2 / S3 / S4 / S6 / S7 的 project folder、conversation、chat、active window、diff / checks、human edit / git、**Space（默认一个 + 按需创建；tile mode）**、S5 的默认 window group；plan note 已有（S2 只做 smoke test）。

**Should**：S5 的 chat 收起 / 后台；S7 的 ui-approval / background service 状态 / cancel（支持时）；S11 的 768 / 快捷键；S8 的 GitLens。

**Later**：完整 application registry；多窗口。自由 window / 任意 split / OS-like 窗口管理当前不考虑；进入路线图需重新裁决。

**First slice**：Space 的默认一个 + 按需创建 + active window（文件 → editor；chat → chat）+ S4 的 diff / chat review + S0 的 first-run + S5 的默认 window group。Project folder 基座不动；S2 只做 smoke test。

## Open questions

1. **Space**：默认一个；是否允许任意增删；window 状态（滚动、active window、panel）跨 Space 保留的范围；project folder 切换时的恢复。
2. **Window group 模型**：先做 active window group + inactive window group + maximize，还是一开始就允许自由 split / 任意 window group；tabs 的归属；move / 键盘。
3. **Panel 默认**：左侧 Explorer 开、右侧收、bottom 收；auto-hide；快捷键；768 drawer。
4. **background service 侧**：plan note 的路径 / 生命周期；人和 background service 共编的可见性 / 冲突 / 版本；plan mode 不是路径；tool approval；checks 的呈现；DSH 支持哪些 cancel / status。
5. **默认 Space / chat 收起**：默认一个；chat application 关闭 / 后台；通知强度。
6. **Application / widget 模型**：VS Code ViewContainer → widget board、ViewDescriptor → widget、editor input → application window；DSH `main` → application window、sidebar/rightbar → board；pin / default placement；application registry 可以 later；free window 当前不考虑。
7. **First-run / project folder**：入口；空 project folder；切换过渡。
8. **Window / window group 管理**：window group 的 tab strip 与 window 内部视觉（GitLens views / terminal tabs / 文件内容）的边界；window 的 label / icon / actions；single-instance 的「只一个」；同一 window 可否跨 window group；launch / focus 的默认 active；preview vs pinned；per-Space tabs / scroll / active window；同一文件多 window；未保存；tab 上限；background service 打开的 file 落在哪个 window group。
9. **768 / 键盘 / 可访问性**。
11. **Review 约定**：S4 的 chat review 约定、checks 的呈现、changed files 的默认打开方式。
12. **Later**：application registry / OS-like 窗口管理是否值得做（free window 当前不考虑）。

## Validation

走一遍 S0 → S11，在当前 application 与目标形态上检查：

- S0：没有 project folder 时只有选择入口；选完才有工作台。
- S1 / S9：project folder 切换后文件 / conversation / background service / Space 跟着换。
- S2 / S3：first prompt、plan note、文件 active window、chat is inactive。
- S4 / S7：diff / checks / note 机制 / ui-approval / human edit / git revert；只呈现 DSH 支持的 status / cancel。
- **S6：默认一个 + 按需创建 / 切换；同一 conversation / 文件跨 Space；每个 Space 的 window group / active window / panel 状态保留；background service 后台继续。**
- S5：默认 window group；chat 收起；background service 状态。
- S3 / S5：editor window 的 breadcrumbs、actions、Outline 在 tab / window 切换后仍指向 active editor；actions 在 window group tab strip 右端，不挤占 breadcrumbs。
- S3 / S5 / S8：Explorer / SCM / GitLens 是 widget board（sidebar / panel）或 stage 的 widget window；Timeline / Outline 等 widget 可以在 board 之间移动；widget 不成为 window group 的 tab，tab 仍是 window。
- S8：GitLens 在 sidebars / panels。
- S11：768、快捷键、drawer。
- project folder / card / diff / GitLens 不回退。

## Related

- UI scheme（OS-like Space / Spaces core）：[2026-10-23-ui-scheme.md](2026-10-23-ui-scheme.md)
- 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)
- 目标形态：[docs/architecture.md](../../../docs/architecture.md)、[docs/philosophy.md](../../../docs/philosophy.md)
- 验收：[docs/ui-acceptance.md](../../../docs/ui-acceptance.md)
