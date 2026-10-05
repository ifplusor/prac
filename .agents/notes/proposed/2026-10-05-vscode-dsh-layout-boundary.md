---
status: proposed
---

# Agent Note: VS Code × DSH 的布局边界 —— 用 shadow DOM 做插件式隔离

> **来源**：2026-10-05 的讨论。James 原话：*我希望有一个更系统的方案来整合 vscode 和 dsh，它们各自取什么、留什么。我想以插件式思维在 layout 上做隔离，如使用 shadow dom。*
> **依据**（命令面板根因、webview 上屏、盒模型补丁、补丁 0002 的来龙去脉）在[工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md) 2026-09-23 与 2026-10-05 各行。本 note 只放**设计**。

## Problem

我们和 VS Code 现在是**两个都假设「整个 document 归自己」的系统**，却共用一个 document。近期三处修补都是这个矛盾的产物：

- 挂进 embedder 的 view 没有尺寸 ⇒ 补一层 `.monaco-pane-view` 给它盒模型（因为 pane 的 CSS 限定在 `.monaco-workbench` 之下）；
- part host 要**手动贴 `monaco-workbench` 类名 + 主题类名**，否则拿不到 VS Code 的样式与变量；
- webview 的 overlay 锚点跨不过 `.monaco-workbench` 子树边界 ⇒ 补丁 0002 把它挪到 `document.body`。

每修一处就冒出下一处（命令面板 → 通知 → hover → context view…），因为**边界是隐式的**：谁都没说清"VS Code 取哪块地、留什么给 prac"，于是只能靠逐步试错去发现。

## 已核实的事实（决定方案形状的六条）

1. **VS Code 的样式是按 document 设计的，不是按区域。** `createStyleSheet(container = mainWindow.document.head, …)`（`src/vs/base/browser/domStylesheets.ts`）是唯一入口，几十张运行期样式表默认都进 head；主题那张表更直接——`_applyRules` 去 `document.head` 里按类名找（`workbenchThemeService.ts:878`）。
2. **主题变量是"作用域选择器"打出来的**：`colorThemeCss` 把 `--vscode-*` 收成一整块 `<scopeSelector> { … }`（`colorThemeCss.ts:62`），调用点传的是 `'.monaco-workbench'`（`workbenchThemeService.ts:561`）。而**自定义属性是继承属性** ⇒ 只要 host 元素带 `monaco-workbench` + 主题类名，shadow root 里面靠继承就能读到 `--vscode-*`。
3. **但规则不会过界**：document 里的样式表**不作用于** shadow tree 内的元素（只有继承属性会过去）。⇒ 每个 shadow root 得有自己的那份样式表，且 root 内要有一个带 `monaco-workbench` 类的元素，否则 `.monaco-workbench …` 那些选择器与主题变量块全落空。
4. **浮层是相对容器定位的**：`.quick-input-widget`、`.notifications-toasts` 都是 `position: absolute`（探针实测 quick input 的 computed 也是 `absolute`），位置由 workbench 的 `dimension`（= 容器矩形，`embeddedWorkbench.ts` 的 `layout()`）算出。
5. **层级上游管好了**：`ZIndex` 九档（Base 0 / Sash 35 / SuggestWidget 40 / Hover 50 / DragImage 1000 / MenubarMenuItemsHolder 2000 / ContextView 2500 / ModalDialog 2600 / PaneDropOverlay 10000）+ `registerZIndex(base, offset, name)` 发 `--z-index-*` 变量，越档直接抛（`src/vs/platform/layout/browser/zIndexRegistry.ts`）；只有 quick input 还是硬编码 2550。
6. **DSH 侧没有层级机制**：各包 CSS module 写字面量（Modal 1000，Toast / Menu 弹层 / OnboardingSurface 1100 为上限），浮层各包自己 `createPortal(…, document.body)`；主题变量前缀是 `--dsh-*` / `--dsl-*`，与 `--vscode-*` **不撞**。

## Proposal（契约：谁给什么、谁留什么）

- **prac（宿主）给**：① 挂点元素（几何由 region 决定）；② 一个**整视口的浮层 host**（透明、`pointer-events: none`）；③ **一个层级数字**（那个浮层 host 的 z-index）；④ 主题变量（`--dsh-*` 那套）。
- **VS Code（插件）给**：① root 内一个带 `monaco-workbench` 类的包装元素；② part 自己的 DOM 与行为；③ 它自己的样式表与主题变量；④ 层内的档位次序（照它自己的 `ZIndex` 表，不劳 prac 管）。
- **两侧都不再够对方的 DOM**：prac 不再需要给 VS Code 的 DOM 补样式（`.monaco-pane-view` 那类修补应消失）；VS Code 不再假设 document 归它。

DOM 形状（两个 host 类型）：

- **part host** —— prac 的 region 里一个元素 + shadow root；root 内 `.monaco-workbench` 包装 + 该 part 的 DOM。决定 2/2b（part 住进 prac 的 view 目录与 region）**不变**。
- **overlay host** —— `position: fixed; inset: 0; pointer-events: none` 的元素 + shadow root；workbench 自己的容器（quick input / context view / hover / 通知 / `monaco-aria-container` / worker iframe）住这里。**这一个 host 的 z-index 就是两边唯一的层级接口**（其余层级比较都退回层内）。

## 子决策（选项 · 代价 · 我的倾向）

### D1｜边界画在哪

- **(a) 两个 host 类型**（part 逐个进 region + 一个整视口浮层 host）：保留决定 2/2b，代价是"两份 root、两份样式投放"。
- **(b) 整块 workbench 一个 host**：VS Code 退回成 prac 的一个视图，边界最简单（一个 root、一个类名、一个 z-index），代价是放弃"part 住进 prac 的 region"——与决定 2/2b、15（堆叠）冲突。

**倾向 (a)**，理由是它不推翻已有裁决；且浮层 host 是 (a) 的必然产物，与 (b) 并不互斥（(b) 就是"part 也塞进那个 host"）。

### D2｜样式怎么进 shadow root（唯一的技术难点）

- **A · 镜像（零补丁）**：embed 里观察 head 中 VS Code 的 `<style>` / `<link>`，同步成构造样式表（`CSSStyleSheet` + `adoptedStyleSheets`）投给所有 root。代价：VS Code 会**原地改写** `textContent`（主题表就是），镜像要处理改写与开销。
- **B · 改默认容器（小补丁）**：`createStyleSheet` 一个入口 + 主题的 `_applyRules`（它直接找 head）⇒ 两处补丁。上游自己就有"把全局样式表克隆进辅助窗口"的先例（`domStylesheets.ts` 的 `globalStylesheets`），说明这条路他们认。

**倾向 B**：A 在"原地改写"上要反复重算，而 VS Code 恰恰这么干。

### D3｜overlay host 的尺寸

必须**整视口**（不是 region）：浮层是相对容器的，若容器只有 region 大，命令面板就会在 region 里居中；而命令面板语义上是"整个窗口的"。代价：prac 要接受"有一层透明的、覆盖全窗口的东西"存在（靠 `pointer-events: none` 不吃事件）。

### D4｜补丁 0002 的归宿

它现在把 webview overlay 挂到 `document.body`（会掉出 shadow 层，且丢样式）。走这条路后应改为挂进 **overlay host**。

### D5｜落地顺序（每步都可验证）

1. **浮层先进 shadow host**（只做 overlay host + 样式投放），判据：命令面板/hover/通知在层内正确出现、可交互，prac 界面不被盖住——**顺带把当前"命令面板看不见"这个待裁一并解决**。
2. **搬一个 part（sidebar）进 shadow host**，验证 `--vscode-*` 随 host 继承进来、该 part 的样式是否需要额外注入。
3. 写死契约、把 prac 侧的 `monaco-workbench` 类名依赖移除（它变成"root 内部的事"）。

## 我真正需要你判断的

1. **D1 选 (a) 还是 (b)**——这决定这个方案的规模（(a) 是两套 host，(b) 与决定 2/2b 冲突）。
2. **D2 选 A 还是 B**——愿不愿意为这件事多背一处上游补丁（它们已经是我们的既定手段）。
3. D3–D5 若无异议我按倾向走。

## 开放问题（尚未决断）

- `monaco-aria-container` 进 shadow root 后读屏可达性（现代读屏一般可以，但要实测）。
- shadow DOM 的调试成本（DevTools 里要展开 shadow tree），是否接受。
- DSH 侧散落的 z-index（6…1100）要不要收敛成一张表——那是独立的一件事，**不该塞进这次修复**。
