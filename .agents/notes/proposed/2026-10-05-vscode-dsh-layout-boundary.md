---
status: proposed
---

# Agent Note: 借来的组件怎么住进 prac 的框架 —— 槽、沙箱、浮层

> **来源**：2026-10-05 讨论。James：「以插件式思维在 layout 上做隔离，如使用 shadow dom」，随后纠正：***整个 ui 框架应该归属于 prac，我们会从 dsh 和 vscode 中借用或借鉴一些现成的组件。***
> **这是第三稿**：第一稿把关系写成"两个 UI 框架谈边界"（错），第二稿发明了一个"整视口浮层 host"（`shell.overlay` 早就有），两稿都把**机制与政策**混着写。本稿按既有口径重写。
> **口径来源**：`docs/architecture.md` §3.1、`2026-09-19-architecture.md`、工作记录的决定台账（编号已退役，本文不引编号）、以及两条 superseded 的设计（09-15 / 09-16）。**新地只有一处**：shadow DOM 与组件级沙箱在既有材料里**未曾出现**（"沙箱"此前只作 agent 运行时能力之义）。
> **依据**（命令面板根因、webview 上屏、盒模型补丁、补丁 0002）见[工作记录](../../worklog/2026-09-09-vscode-dsh-integration.md) 2026-09-23 与 2026-10-05 各行。

## Problem

现状用三处补丁维持"借来的组件能住下"：

- 挂进 embedder 的 view 没有尺寸 ⇒ 补一层 `.monaco-pane-view` 给它盒模型；
- part host 手动贴 `monaco-workbench` + 主题类名（代码注释自己写着 *a part mounted outside that context is unstyled*），并**每 200ms 轮询一次主题类**；
- webview overlay 的锚点跨不过 `.monaco-workbench` 子树边界 ⇒ 补丁 0002 把它挂到 `document.body`。

三处是同一个病的三次发作：**借来的组件默认 document 归它**（VS Code 的样式默认进 `document.head`，浮层默认往 body 挂），而宿主既没给它一个盒子，也没说浮层该找谁。

## 口径（沿用既有裁决，不新造）

- **UI 框架归 prac**：区域树、编排、层级、浮层都不外包。
- **机制与政策分层**：`vendor/vscode-embed` 是 lib，只给机制不背政策；政策在 prac 的插件族。**机制层不认识任何来源词**——`vscode` / `扩展宿主` / `part` 这类词只出现在边界与政策层（`part` 只作边界词）。
- **两种槽已经存在，且与来源无关**：`prac.view`（住一个视图宿主）与 `shell.overlay`（叠整帧的加成槽）。**不新造第三种**。

## 两条已经踩过的否决（免得再犯）

- 「遮蔽 root 即可拥有拓扑」已被否：`ui-slots` 明文 DO NOT register，**应注册进 `shell.overlay`**。
- 09-15 那条 superseded 的设计里已经写了「**通知/弹窗没有 DOM，需要 `shell.overlay` 或某个 region**」；09-16 的 tier C 也把对话框 / quick pick / 进度归在 client 渲染。⇒ **浮层归宿主不是新想法**，本文只是把它落到实现。

## 机制给什么（与来源无关）

1. **两种槽**（已有）：view 槽与浮层槽。浮层槽今天就是 `shell.overlay`——`position: absolute; inset: 0; z-index: 20; pointer-events: none`，配一条 `[data-prac-overlay-layer] > * { pointer-events: auto }`；注意力条与召回面已经住在里面。
2. **沙箱选项**（新）：槽可以声明"沙箱化"，机制只提供 shadow root、样式投放、主题变量过界——**它不知道里面是谁**。
3. **几何与层级**：槽的盒子由 region / frame 给；浮层槽的 z 由 frame 定。

## 政策决定什么（插件族）

1. **谁住沙箱槽**：借来的 IDE part / view 住沙箱槽；DSH 自家视图住普通槽（同一个框架里不需要隔离）。
2. **借用件的浮层载体住浮层槽**，不自己往 body 挂——补丁 0002 那处改成挂进浮层槽。
3. **上游标识只出现在政策层与边界**：`monaco-workbench`、`vs`/`vs-dark` 这些类名沙箱化之后退进 root 内部，宿主侧不再镜像、也不再轮询。

## 技术边界（已核实，决定要做多少事）

- VS Code 侧：`createStyleSheet(container = document.head)` 是样式唯一入口（几十张运行期样式表默认都进 head），主题那张表由 `_applyRules` 直接找 head；主题变量打成一整块 `.monaco-workbench { --vscode-*: … }`。
- **变量能过 shadow 边界**（自定义属性可继承）**，规则不能**（document 里的样式表不作用于 shadow tree）⇒ 每个 root 要有自己那份样式表，且 root 内要有一个带 `monaco-workbench` 类的包装元素。
- 浮层是**相对容器**定位的（quick input 与通知都是 `position: absolute`，位置由 workbench 的 `dimension` ＝ 容器矩形算出）⇒ 容器一旦有真实几何，浮层就落对：**当前那个 0×0 与"命令面板看不见"是这个修法的顺带结果**。
- 沙箱槽的形状有代码依据：`ViewPaneContainer.create(parent)` 能造进任意外部元素；代价是**借一个 view 就是借它一整套 chrome**（sash、菜单、header actions、拖放）。

## 子决策（选项 · 代价 · 我的倾向）

### D1｜沙箱手段
shadow DOM（倾向）／普通 DOM 约定／iframe —— 建议**按类别定**：借来的 part 与 view 用沙箱；webview 本来就是 iframe（隔离已够）；DSH 自家视图不隔离。

### D2｜样式怎么进 shadow root
- **A 镜像（零补丁）**：embed 里观察 head 中 VS Code 的 `<style>`/`<link>`，同步成构造样式表（`CSSStyleSheet` + `adoptedStyleSheets`）投给所有 root。代价：上游会**原地改写** `textContent`（主题表就是），镜像要处理改写与开销。
- **B 改默认容器（小补丁）**：`createStyleSheet` 一个入口 + `_applyRules` 一处 ⇒ 两处补丁；上游自己就有"把全局样式表克隆进辅助窗口"的先例。
- **倾向 B**：A 在"原地改写"上要反复重算，而 VS Code 恰恰这么干。

### D3｜浮层舱位的两条细节
1. **"容器形客人"与现有放行规则冲突**：`[data-prac-overlay-layer] > *` 是"直接子元素自己接管事件"，而借用件的浮层容器是**铺满整层**的——它必须保持 click-through，只让自己的浮层件接管。要么给这种客人一个 passthrough 变体（标记属性 + 反向规则），要么换个形状。
2. **层号 20 的语义**：DSH 的 Modal 1000、Toast 与菜单弹层 1100 都在 frame 之外 ⇒ 命令面板放进去后**低于**它们。这可能正好（对话框压住一切），也可能不是。

### D4｜落地顺序（每步可验）
1. **借用件的浮层载体进浮层槽**（顺带解掉命令面板）：判据＝命令面板 / hover / 通知在浮层槽里正确出现、可交互，prac 界面不被整片盖住。
2. **一个 part 进沙箱槽**（sidebar）：验 `--vscode-*` 是否随槽继承进来、该 part 的样式要不要额外注入。
3. **写死契约**：删掉类名镜像与 200ms 主题轮询，把 `.monaco-pane-view` 那笔补丁撤掉。

## 三处补丁在新框架下的归宿

| 现状 | 归宿 |
| --- | --- |
| 给 pane 补 `.monaco-pane-view` 盒模型 | **消失**（沙箱槽自己给盒子） |
| part host 贴 `monaco-workbench` + 主题类、200ms 轮询 | **退进沙箱内部**（宿主侧不再镜像、不再轮询） |
| 补丁 0002 把 webview overlay 挂 `document.body` | 改成**挂进浮层槽** |

## 我真正需要你判断的

1. **D1**：沙箱手段按类别就定 shadow DOM 吗？
2. **D3**：浮层舱位的两条细节——尤其**命令面板要不要压过 DSH 的模态与提示**（这决定浮层槽的层号）。
3. **D2**：愿不愿意为样式投放多背一处上游补丁。

## 开放问题（尚未决断）

- `monaco-aria-container` 进 shadow root 后的读屏可达性（要实测）。
- shadow DOM 的调试成本（DevTools 要展开 shadow tree），是否接受。
- DSH 侧散落的 z-index（6…1100）要不要收敛成一张表——独立的一件事，**不该塞进这次**。
