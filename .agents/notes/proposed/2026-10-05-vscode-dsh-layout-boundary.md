---
status: proposed
---

# Agent Note: prac 的 UI 框架与借来的组件 —— 边界怎么划

> **来源**：2026-10-05 讨论。James 先提「以插件式思维在 layout 上做隔离，如使用 shadow dom」，随即纠正了框架：***整个 ui 框架应该归属于 prac，我们会从 dsh 和 vscode 中借用或借鉴一些现成的组件。***
> ⇒ **不存在"两个 UI 框架共处"**：只有一个框架（prac 的），加两种**组件来源**。本 note 的第一版把关系写成"两个都假设 document 归自己的系统谈一条边界"，方向错了，这里改写。
> **依据**（命令面板根因、webview 上屏、盒模型补丁、补丁 0002 的来龙去脉）在[工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md) 2026-09-23 与 2026-10-05 各行。

## Problem

我们一直在给借来的组件**擦屁股**，三处修补是同一个病的三次发作：

- 挂进 embedder 的 view 没有尺寸 ⇒ 补一层 `.monaco-pane-view` 给它盒模型；
- part host 要**手动贴 `monaco-workbench` 类名 + 主题类名**，否则拿不到样式与变量；
- webview 的 overlay 锚点跨不过 `.monaco-workbench` 子树边界 ⇒ 补丁 0002 把它挪到 `document.body`。

病根不是"两个系统抢 document"，而是**契约没定**：借来的组件默认 document 归它（VS Code 的样式默认进 `document.head`、浮层默认挂 `document.body`），而宿主没给它一个盒子、也没说浮层该找谁。于是每修一处就冒出下一处（命令面板 → 通知 → hover → context view…）。

## 口径：归属先说清

- **UI 框架归 prac**：frame、region 树、view 目录、编排、**层级**、**浮层**都是 prac 的（`prac-client-ui-layout` + `prac-web-app`）。DSH 的 `ui-layout` 是被我们**借鉴后 replaced** 的，不是框架本身。
- **两种组件来源**：
  - **DSH**：会话 / 审批 / 工作区 / 设置这些视图，基础控件（`ui-primitives` 的 Button / Menu / Modal / Toast / Tooltip），主题变量（`--dsh-*` / `--dsl-*`），以及客户端插件机制（view 注册与槽位）。
  - **VS Code**：IDE 那套 part（editor / sidebar）、扩展渲染（extension host / webview）、编辑器与 Monaco，以及 quick input / hover / context view 这些交互件。
- **借用 ≠ 借鉴**：**借用**是直接用它的实现（于是必须给它一个沙箱，边界问题都出在这一类）；**借鉴**是照它的做法自己写（不产生边界问题）。本文只谈借用那一类。

## 契约（每个借来的组件）

1. **prac 给**：一个**沙箱槽**（region 里的元素 + 几何）、主题变量（`--dsh-*` 那套）、以及**浮层配额**（见 D2）。
2. **组件给**：自己的 DOM / 样式 / 行为；只通过槽元素上的属性与事件跟 prac 说话；**不假设 document 归它**、**不往 `document.body` 挂东西**、不读 prac 的 DOM。
3. **浮层是这条契约的试金石**：借用件需要浮层时**向 prac 申请**（说清用途与作用域：整窗口 / 本 region），由 prac 决定它落在哪、叠序是多少。
   ⇒ 这一条**推翻了我上一版的想法**（"给借用件一个整视口 host，再谈判一个 z-index"）——那等于把 prac 的框架职责让给了借用件。

## shadow DOM 在其中的角色

它是**沙箱的实现手段**，不是"两个框架之间的邦交线"：

- 好处直接对上"借用"：样式不外泄、prac 的 CSS 不进去 ⇒ 借来的组件可以被摆到任意 region，而 **prac 不需要为它的内部布局写适配样式**（`.monaco-pane-view` 那种补丁本就不该存在）。
- **已核实的技术边界**（决定了要做多少事）：主题变量**能过去**——`--vscode-*` 是打成一整块 `.monaco-workbench { … }` 的作用域规则，而自定义属性是继承属性，只要槽元素带那个类名就能被 root 继承；**规则不能过去**——document 里的样式表不作用于 shadow tree 内的元素。⇒ 每个 root 要有自己那份样式表，且 root 内要有一个带 `monaco-workbench` 类的包装元素。
- **备选**（要逐类比较，不是二选一）：普通 DOM + CSS 约定（现状，最弱）；iframe（隔离最强，但要过消息，Monaco / 扩展宿主这种紧耦合用不了）。

## 子决策（选项 · 代价 · 我的倾向）

### D1｜沙箱手段
shadow DOM（倾向）／普通 DOM 约定／iframe —— 建议**按组件类别分别定**：VS Code 的 part 与 view 用 shadow DOM；webview 本来就是 iframe（隔离已经够了）；DSH 自家的视图不隔离（同一个框架）。

### D2｜浮层服务长什么样
prac 提供统一的层（按用途 / 作用域申请）。借用件内部的浮层**先尽量留在自己的槽内**（相对槽定位）；只有语义上属于"整个窗口"的（命令面板、全局通知、模态）才申请整窗口层。代价：要给 VS Code 这类"自己就有一套浮层机制"的组件做一层收编（把它的 container 指到 prac 给的层）。

### D3｜样式怎么进 shadow root（shadow DOM 下的唯一技术难点）
- **A 镜像（零补丁）**：embed 里观察 head 中 VS Code 的 `<style>` / `<link>`，同步成构造样式表（`CSSStyleSheet` + `adoptedStyleSheets`）投给所有 root。代价：VS Code 会**原地改写** `textContent`（主题那张表就是），镜像得处理改写与开销。
- **B 改默认容器（小补丁）**：`createStyleSheet(container = document.head)` 是唯一入口，主题那张表另加 `_applyRules`（它直接找 head）⇒ 两处补丁；上游自己就有"把全局样式表克隆进辅助窗口"的先例（`domStylesheets.ts` 的 `globalStylesheets`）。
- **倾向 B**：A 在"原地改写"上要反复重算，而 VS Code 恰恰这么干。

### D4｜借用件往 `document.body` 挂东西怎么办
**收编**（把它的挂载点改到 prac 的层）——补丁 0002 那处就该改成"挂进 prac 的层"；或者**允许**（等于默认破契约，那三处修补会继续长出来）。倾向前者。

### D5｜落地顺序（每步可验）
1. **浮层收归 prac**：给 prac 一个层服务，把 VS Code 的 workbench 容器指过去 —— 判据：命令面板 / hover / 通知在 prac 给的层里正确出现、可交互，prac 界面不被盖住（**顺带把当前"命令面板看不见"这个待裁一并解决**）。
2. **一个 part 进 shadow 沙箱**（sidebar）：验 `--vscode-*` 是否随槽继承进来、该 part 的样式要不要额外注入。
3. **写死契约**，并把 prac 侧对 `monaco-workbench` 类名的依赖移除（它变成"沙箱内部的事"）。

## 我真正需要你判断的

1. **D1**：沙箱手段就定 shadow DOM 吗（按类别：VS Code 的 part / view 用，webview 维持 iframe，DSH 自家视图不隔离）？
2. **D2 + D4**：浮层收归 prac 是先做还是先留现状？这是"框架归 prac"最锋利的一刀，也直接决定当前那个命令面板怎么修。

D3、D5 若无异议我按倾向走。

## 开放问题（尚未决断）

- `monaco-aria-container` 进 shadow root 后的读屏可达性（一般可以，要实测）。
- shadow DOM 的调试成本（DevTools 要展开 shadow tree），是否接受。
- DSH 侧散落的 z-index（6…1100）要不要收敛成一张表——那是独立的一件事，**不该塞进这次**。
