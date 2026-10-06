# 布局边界 —— 工作记录（依据）

> **这不是 note**：它是**这项工作**（[2026-10-05-vscode-dsh-layout-boundary.md](../notes/in-progress/2026-10-05-vscode-dsh-layout-boundary.md)）的**依据**——里程碑与过程、讨论产出的事实、代码层约束、待验证。
> 它**没有状态轴、不签字**：这里只有"当时发生了什么、哪个说法被否掉、还欠哪些验证"。
> **上游**：融合侧的口子（命令面板 0×0、webview 上屏、盒模型）记在[融合工作的记录](2026-09-09-vscode-dsh-integration.md)——现象的出处在那里，设计结论在 note。

## 里程碑

| 日期 | 做了什么 | 依据（判据 / 证据） |
| --- | --- | --- |
| 2026-10-05 | **James 连出九条裁决（逐条都改了设计）**。原文：① ***"所有挂在 layout 中的 view 都应该隔离；所有 view 都应该对等。我们不只有浮层。"*** ② ***"我们的布局有基础的区域分隔，stage 是这一层的。基础区域之上才是悬浮层，如 popup、通知、命令 等。view 住在容器里，我们说的基础区域即为 view 容器。view 的拖放是在容器之间切换。stage 容器支持分栏分列，像 vscode 的 editor group。"*** ③ ***"悬浮层也应该是容器。"*** ④ ***"view = 窗口，而不是容器 = 窗口。"*** ⑤ ***"tab 不是 stage 专有的。"*** ⑥ ***"选中是 UI 状态，也应该在持久化中。"*** ⑦ ***"stage 拆分子区域时，每个子区域都有 tab。这样 stage 不应该支持 stack。"*** ⑧ ***"sidebar 和 bottom 区域可能不应该支持拆分，且 bottom 区域也只支持 tab。"*** ⑨ ***"tab stack 应该是区域的布局模式，这样区域是对等的。而我们的命名区域，会绑定可用的模式。"*** | 过程的产物是 [note](../notes/in-progress/2026-10-05-vscode-dsh-layout-boundary.md) §已定的设计 |
| 2026-10-05 | **这一稿之前被否掉/错掉的框架（防止重演）**。否掉：把关系写成"两个 UI 框架谈边界"；一个"整视口浮层 host"（`shell.overlay` 早就有，不必发明）；让组件"遮蔽 root 即可拥有拓扑"（`ui-slots` 明文 **DO NOT register**，正路是注册进 `shell.overlay`）。错掉（我自己的）：把容器当成既给几何、又是被摆弄的单位；把悬浮层当成与容器不同的另一种东西；按内容性质或来源给 view 分类（"借来的住隔离槽、自家的住普通槽"）；把 tab 当成 stage 专有；**把"选中"划给注意力、因而排除在持久化之外**；"区域对等"与"bottom 只能 tab"并置而不分层 | note 曾**九次改稿**；修订史只留这一行（note 里不写修订史）。`root` 槽那条：DSH `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1501` + 融合 worklog「已核实事实 / DSH 侧」 |
| 2026-10-05 | **讨论里出现的错误类比（留档）**：把悬浮层想成"每个 view 各有一块自己的浮层平面"（与"基础区域之上才是悬浮层"相冲）；把区域当成"窗口"（应为 view = 窗口）；用「帧」指布局（James：会让人联想到视频画面）。**共同点：拿渲染 / 桌面的直觉去套另一层的概念**——而 prac 的 `frame`（英文）指拥有区域树的那套机制，中文里不译 | 本仓「帧」只作协议义（RPC 帧 / 首帧全文 / 12 种 type），布局义只有过那一处，已改 |
| 2026-10-05 | **一次性写进 `docs/architecture.md` §3.1、又被 James 拦下**：他明确"不要不管什么东西都塞到 architecture.md"。本工作因此走 note + worklog 两件，**不碰现在时文档**，直到他点头 | 同类纠正有一次在先：2026-09-21 的"配置怎么手改"配方被从 `architecture.md` 挪进 `packages/host/vscode/README.md`（见融合 worklog） |
| 2026-10-05 | **隔离由框架保证，但形态可以多种（James）**：“隔离应该由框架保证，但是我们可以根据具体情况有多种实现”。⇒ 保证与实现分离：**"每个视图都被隔离"是框架的事**（不是内容自愿配合），**形态是实现**（影子域 / 独立浏览上下文 / 将来别的），由**框架按内容性质选**，结果**记进视图身份**、进持久化与调试。**推论**：① 隔离**不由视图选择**，否则"我不用隔离"的例外会把统一性破掉；② webview 本来就是"独立浏览上下文"这一形态，所以"所有视图对等"与"隔离形态不同"不冲突——**对等说的是契约，不是实现**；③ 框架从此要为"强制"负责（实验 1 的代价表是**影子域这一形态在 DOM 内容上的**代价，不是全部形态的代价）。 | 未定：形态与内容的对应规则（谁算"自成体系的内容"）；以及**不同形态对 G1–G3 的满足方式不同**（iframe 里"出不了盒子"是浏览器保证的，影子域要靠投放正确） |
| 2026-10-05 | **实验 2（真部件住进影子根）：通过**。用独立查看页（`vendor/vscode/scripts/serve.mjs`，不依赖 DSH）+ Playwright：把 `workbench.parts.sidebar` 的宿主搬进影子根、把页面的 15 张 `<style>` 与那张 workbench CSS 一并投进根。读数：**几何逐像素不变**（`[48,30,260,568]` → 同）、**像素差 0**（147680 像素，`changed:0 maxDelta:0`）、31 个元素、文本照常、**无 pageerror**；对照图 `.build/scratch/exp2-part-before.png` / `exp2-part-in-shadow.png`。⇒ **DOM 内容住影子域可行**：部件自身的布局与绘制不因边界而坏。 | **两条边界要记住**：① 这是**独立查看页**，没走 embed bridge / DSH rig——「宿主在桥下被搬进根」这条还没验；② 那次探针把部件跑到右侧，**是我的 shell 插错位置**（追加到 flex 末尾），插回原位后像素全等——**教训：布局对照必须先保证位置一致** |
| 2026-10-05 | **借用件的浮层也走框架（James）**：“借用件的浮层也走框架，这才是 adaptor 的意义”。⇒ 把 adaptor 的职责说全了：它不只是把上游样式投进边界，还要**把借用件要浮出来的东西搬进框架的悬浮层**。**这一条把两个先前散着的东西收成一处**：① 前面注意到的边界问题「机制要对借用件也可用」——adaptor 就是那座桥；② 2026-10-05 那次把 webview overlay 挂到宿主 document.body 的补丁——它是这条设计**要取代的那种局部处置**（同样的事，当年没有原则可依）。**同时它让「浮层归谁」在两边一致**：prac 自己的视图与借用件，浮出来的东西都住同一个悬浮层、由同一套机制定序。 | 深度待定：只换承载（内容与行为照旧、交给框架定序）还是连行为也换（键盘导航 / 关闭 / 层序由框架接管） |
| 2026-10-05 | **借用件的适配归 `vscode-host`（James）**：“对如 monaco-workbench 等，实现上应该是由 vscode-host 做 adaptor，这样应该会更简洁”。⇒ 框架**只提供隔离本身**（盒子 + 边界），`monaco-workbench` / `--vscode-*` / 上游样式表 / 借用件浮层**全收进 adaptor**；**不需要"沙箱槽"这类特殊槽——就是普通槽 + 宿主元素**。**理由（三条）**：① `2026-09-13` 已裁"机制不认识来源词"，这让它落成结构而不是纪律；② 框架不需要知道里面是 VS Code；③ 与既有分层一致（机制在 `vendor/vscode-embed`，政策在插件行）。 | 与实验 1 接得上：变的是**投放位置**（逐根）与**实现落点**（adaptor），上游的范围参数与构造表投放本来就在。**未定**：adaptor 与框架之间那条边要不要显式接口；借用件的浮层是桥给框架还是用本地实现 |
| 2026-10-05 | **实验 1（主题/样式跨影子边界）：做掉了，并证伪了自己的一条断言**。做法：Playwright chromium + 自足 fixture（模拟三张 head 表：`:root` 变量、`.monaco-workbench` 变量块、`.monaco-workbench …` 规则表）+ 影子域内 `adoptedStyleSheets` 投规则。读数：`:root` 的 `--vscode-font-family` 影子内**继承到了**；`.monaco-workbench` 上的 `--vscode-editor-foreground` 影子内**为空**；document 的同一条规则**不命中**影子树；投进影子域的那份**命中**（`font-family` 生效）。⇒ 原先“变量能过边界、放个包装元素就白拿”的写法**错**：**只有 `:root` 级变量会继承，外层类上的不会**，所以**变量与规则都得逐根投放**。 | 源码侧：`generateColorThemeCSS(theme, scopeSelector, …)` 把颜色+尺寸变量拼成**一条** `${scope} { --vscode-* }`（`workbench/services/themes/browser/colorThemeCss.ts:20,60`），workbench 用 `.monaco-workbench` 并注入 `document.head`（`workbenchThemeService.ts:559`、`_applyRules :878`）⇒ **逐根生成变量有现成参数**；上游测试 fixture 同样是 `CSSStyleSheet` + `replaceSync`（`workbench/test/browser/componentFixtures/fixtureUtilsCss.ts:215`）。细则见本文「实验 1」 |
| 2026-10-05 | **区域名 `sidebar` → `leftbar`（James）**：与 `rightbar` 对称，也和 `stage` / `bottom` 一起构成"按位置命名"的一套。⇒ 设计层这么叫；**来源词不动**——DSH 的槽名 `sidebar`、VS Code 的 `workbench.parts.sidebar`、以及 prac 侧现有的 `vscode:sidebar` / `dsh:sidebar` / `ctx.layout` 的 sidebar 方法**都还没改**，属实现层的改名工作 | 待改的地方已知：`packages/bundle/web-app/src/client/arrangement.ts`（`ROLES.sidebar`、`VSCODE_SIDEBAR_VIEW`）、`packages/client/ui-layout/src/client/{catalogue,contract}.ts`、`packages/client/vscode-host`（`SIDEBAR_PART`）。**改这些会牵动闸门**（`verify-layout` / `verify-views` 用 view id 选 host），与 2026-09-15 那次改名同型 |
| 2026-10-05 | **右键菜单归框架的机制（James）**：原话"右键菜单不应该留在窗口里，而应该由框架提供机制，否则就太奇怪了。vscode 和 chrome 都会使用 macOS 提供的右键菜单"。⇒ 窗口只声明要什么，**呈现**（定位、贴边翻转、关闭、键盘可达、层序）归框架；跨边界那条通路的适用范围因此被削掉一角（右键菜单不再悬着）。**同时它给"悬浮层是区域"（裁决 ③）提供了第一个正向用例**：框架的面就住在那里 | **为什么这不是偏好**：VS Code 与 Chrome 的右键菜单都不是自己画的，走的是 **macOS 系统菜单**（同一形状在别处映射到平台菜单）。内容自带菜单 = 各造一套，既不可能一致也拿不到平台该给的东西。**待验**：在 web 形态下"平台菜单"落到哪（浏览器原生菜单能给什么、哪些必须自绘），以及框架机制需要的那套**全局布局坐标空间 + 锚点失效/跟随规则** |

## 已核实事实

### 讨论产出（非代码核实，2026-10-05）

> 这批事实来自与 James 的设计对话。它们界定的是"框架对盒子里的东西负什么责"。

- **布局只有一类东西：区域**，出现在两个位置——**基础区域**（`stage` 是这一层的区域）与**悬浮层**（基础区域之上，住 popup / 通知 / 命令）。**view 住在区域里；view 的拖放 = 在区域之间搬窗口。**
- **view = 窗口，区域 = 骨架；区域不是窗口。** 区域承担划分空间与给盒子；view 是被摆放、被拖动、被隔离的单位。
- **区域可嵌套**：`stage` 拆子区域时，每个子区域都有各自的 tab。
- **基础层只有三种布局模式：分区 / 顺序（`stack`）/ 选择（`tab`）；叠放只在悬浮层。** 依据：**叠放 = 同时可见 + 需要定序**；tab 同一时刻只显示一个 ⇒ 无需定序 ⇒ **tab 属选择、不是叠放**。
- **tab / stack 都是区域可用的布局模式（机制层），区域本身对等**；**哪个区域能用哪些、默认哪个，由"命名区域"绑定**（`stage` 默认 tab、不支持 stack；`bottom` 只 tab；`leftbar` / `rightbar` 默认 stack、也能有 tab）。**这是数据，不是特权**——换名字或换绑定即可换行为，不动机制。
- **"选中"是布局的可持久化 UI 状态**（与"注意力 / 返回栈"是两回事：后者是交互过程，不持久化）。因此基础层持久化该有：**窗口在哪个区域、组内顺序、折叠、在屏上、每个组的选中项、区域用的模式**；**不该有**：窗口层序、注意力栈、返回栈。
- **层级两段**：区域之间的层序归框架（**只有这一张表**）；窗口内部的层序归窗口自己。sash / 拖放落点 / 焦点环这类是**框架自己的装饰**，不参与内容层序。

### 代码层（2026-10-05 复核 `.build/vscode` 与 `vendor/`，界定契约的约束与代价）

> **这一节只界定约束，不是实现方案。** 行号指当时的 checkout。

- ~~**主题变量能过隔离边界、规则不能**~~ **← 实验 1 更正**。准确的边界（实验 1 + 实验 2 的合成对照，四组读数）：**`:root` 上的自定义属性会继承进影子树；定义在 `.monaco-workbench`（影子之外）的那一份不会**；document 的规则表不作用于影子树。
  在根内把变量解析出来需要**两件事同时成立**：**变量块投进根** + **根内有一个带 `monaco-workbench` 类的包装元素**——只投规则（有包装类）时变量为空、颜色错；两样都投时变量解析为 `rgb(1,2,3)`、颜色正确。
  ⇒ 原先"放个包装元素就白拿变量"的说法要改成：**包装元素必要但不充分；变量块与规则都得逐根投放**。
- **样式的唯一入口**：`createStyleSheet(container = mainWindow.document.head, …)`（`src/vs/base/browser/domStylesheets.ts:37`），并**自带"把全局样式表克隆进辅助窗口"的先例**（`globalStylesheets` / `cloneGlobalStyleSheet`）；主题那张表由 `_applyRules` **直接找 head 原地改写 `textContent`**（`src/vs/workbench/services/themes/browser/workbenchThemeService.ts:878-887`）。⇒ "改默认容器"这类改法只需两处，但等于让边界依赖上游内部；"镜像"则要处理原地改写。
- **主题类会在运行期整体换**：`layoutService.mainContainer.classList.remove(...)` / `add(...)`（`workbenchThemeService.ts:121`、`:572-576`）。而 part host 上那份拷贝是**启动期收敛式**的（拿到主题就停表，见 `vendor/vscode-embed/src/client/index.ts:459-474`）⇒ **换主题后 host 会留旧类**，这是契约问题（要订阅，不是轮询）。
- **浮层相对容器定位**：quick input 挂在 `layoutService.activeContainer` 下（`src/vs/platform/quickinput/browser/quickInputController.ts:122-164`），用 `getContainer(...).getBoundingClientRect()` 定 top/left（`:956`）；`.quick-input-widget` 是 `position: absolute`（`quickInput.css:7`）。⇒ **容器一旦有真实几何，落位就跟着对**——命令面板那次的根因就是几何（0×0），不是"放哪"。
- **借一个 view 就是借它一整套 chrome**：`ViewPaneContainer.create(parent: HTMLElement)` 能造进任意外部元素（`src/vs/workbench/browser/parts/views/viewPaneContainer.ts:383`），代价是 sash / 菜单 / header actions / 拖放一起借来。
- **框架自己的装饰现状**：区域之间的 sash 带 `z-index: 5`（`packages/client/ui-layout/src/client/frame.ts:316`），浮层槽是 `absolute; inset: 0; z-index: 20` + `[data-prac-overlay-layer] > * { pointer-events: auto }`（`:313`、`:659`）。⇒ 基础层的"层号"目前只有这两处，契约要求它收敛成**一张表**。
- **上游已有"服务 + 锚点 + 影子根"的形状**：VS Code 的 `IContextViewService.showContextView(delegate, container?, shadowRoot?, useWindowContainerForShadowRoot?)`（`src/vs/platform/contextview/browser/contextView.ts:23`）——**"谁来显示"是一个服务、"锚在哪"由调用方给，而且它自己就带影子根选项**。⇒ "菜单 / 命令 / 通知由框架提供机制"在上游有同形先例；**隔离与这条通路可以共用同一个承载**。

## 待验证（在把契约写死之前）

> 都是**待做的验证工作**（不是"还没定的设计"）。在它们有结论之前，布局契约不该被写死。

1. ~~主题/样式能否跨统一隔离边界~~ → **已做（实验 1–5）**。**两条挂载路各有证据**：视图路（`mountViewInto`）在**真 rig** 上像素零差（实验 4）；整部件路（`partHost`）在**独立查看页**上像素零差（实验 2）——**它在 rig 里没有消费者**（编排只注册了 `vscode:sidebar`，见实验 4 末尾），要等有视图映射到 part 时再补验。换主题：**变量被原地改写、订阅看得见**已验（实验 5）；**画面是否跟着变**在实验 6B 里证明“不能靠 poke 变量来判断”（连文档里改获胜表都不改画面）⇒ 这条留给“真的切一次主题”或实现后端到端验。整部件路的配方已验（实验 6A：库真实宿主形状 + 配方 = 像素零差）。
2.（实验 2 已过：真部件住影子根像素全等；剩下的是**在 rig 上、走 embed bridge** 验一遍。）**区域有真实几何时，进入悬浮层的东西是否自然落对**——2026-10-05 那条"给 boot 容器与 workbench 视口几何 + 放行覆盖层事件"的临时修法已在域名上实测可用（quick input 渲染出 19 行、与 prac 界面同屏不遮挡，见融合 worklog「里程碑」2026-10-05 第一行）；要验的是**它是不是全部**（还有没有别的落错方式）。
3. **统一隔离对轻量内容的实测代价**——数字出来之前，"所有视图对等"是原则，不是已被证明可行的原则。

## 实验 1：主题与样式能否跨统一隔离边界（2026-10-05 已做）

**问题**：走影子域的话，主题变量与 VS Code 的样式表能不能进到 root 里、代价多大。

**做法**（`node --input-type=module` + Playwright chromium，自足 fixture，不依赖 dev rig）：模拟 VS Code 的投放结构——三张表在 `document.head`：`:root { --vscode-font-family }`、`.monaco-workbench .monaco-list-row { color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family) }`、`.monaco-workbench { --vscode-editor-foreground: rgb(1,2,3) }`；影子域内放 `.monaco-workbench` 包装元素，用 `CSSStyleSheet` + `adoptedStyleSheets` 投规则表。

**结果**（实测读数）：

| 检查 | 读数 | 含义 |
| --- | --- | --- |
| `:root` 上的 `--vscode-font-family` | 影子内 = `"Segoe UI"` | **根级自定义属性会继承进影子树** |
| `.monaco-workbench` 上的 `--vscode-editor-foreground` | 影子内 = **空** | **外层类上的变量不会跨**（定义它的规则在影子外，不匹配） |
| 文档规则表里的 `.monaco-workbench .monaco-list-row` | 影子内 color = `rgb(0,0,0)`（未命中） | **document 的规则不作用于影子树** |
| `adoptedStyleSheets` 投进去的同一份规则 | 影子内 `font-family` = `"Segoe UI"` ⇒ **命中**；color 空是因为变量为空 | **逐根投放规则可行、有效** |
| `CSSStyleSheet.replaceSync` / `adoptedStyleSheets` | 都支持 | 构造样式表可用 |

**源代码侧的两条**（`.build/vscode`）：

- **主题变量是一个可带 scope 的整块**：`generateColorThemeCSS(theme, scopeSelector, …)` 把颜色与尺寸变量拼成**一条** `${scopeSelector} { --vscode-*: …; --vscode-*-size: … }`（`workbench/services/themes/browser/colorThemeCss.ts:20,60`）；workbench 用的是 `.monaco-workbench`（`workbenchThemeService.ts:559`），并把它注入 `document.head`（`_applyRules`，`:878`）。
- ⇒ "改默认容器 / 逐根投放变量"这条路**上游有参数可直接用**；上游测试的 fixture 也是这个用法（`test/browser/componentFixtures/fixtureUtilsCss.ts:215`，`CSSStyleSheet` + `replaceSync`）。

**结论（影响成本表）**：

1. **"放个包装元素就白拿变量"这个说法要改准**：包装元素**必要但不充分**；**变量块与规则表都得逐根投放**（四组读数见「已核实事实」那条更正）。
2. **选项 A（镜像）与 B（改默认容器）都比原来想的可行**：A 的"原地改写"难点有零补丁修法（实验 3：盯源表 + 重投）；B 的变量块本来就是**一条可带 scope 的规则**（`generateColorThemeCSS`），规则表的构造表投放也已验证有效。
3. **仍未验**：整条链在**真 rig** 上、走 **embed bridge** 跑通（真主题表规模 ≈ 250 条变量 × 每 root 一份）。

## 实验 2：真部件住进影子根（2026-10-05 已做）

**问题**：一个**真的** VS Code part 被搬进影子根之后，几何、绘制、主题还正不正常。

**做法**：不起 DSH——用**独立查看页**（`vendor/vscode/scripts/serve.mjs` + `.build/vscode/out-vscode-web`，就是 `vscode:smoke` 那个页面）起在 `:5199`；Playwright 打开后，把 `workbench.parts.sidebar` 的宿主搬进影子根，并把页面上的 15 张 `<style>` 与 `link[rel=stylesheet]`（`workbench.web.main.internal.css`）一并投进根。

**读数**：

| 检查 | 搬进影子根前 | 搬进影子根后 |
| --- | --- | --- |
| 宿主几何 | `[48, 30, 260, 568]` | **完全相同** |
| 像素差（同一 clip，逐像素） | — | **0 / 147680**（`maxDelta 0`） |
| 元素数 / 文本 | — | 31 个元素、`Drag a view here to display.` |
| pageerror | — | **0** |

对照图：`.build/scratch/exp2-part-before.png` / `.build/scratch/exp2-part-in-shadow.png`。

**过程中自己踩的坑（值得记）**：第一版探针把 shell **追加**到 flex 末尾，部件跑到页面右侧，像素差 94%——看着像"隔离把布局搞坏了"，其实是**我的插入位置错了**。插回原位后像素全等。⇒ **布局类对照实验，先保证搬动前后位置一致，再谈差异**。

**结论与边界**：

1. **DOM 内容住影子域可行**：部件自身的布局与绘制不因边界而坏（至少这个侧栏部件）。
2. **两条没覆盖**：① 这是**独立查看页**（无 embed bridge、无 DSH、无 prac 的 stage/区域树）——"宿主在桥下被搬进根"没验；② 这个页面的宿主是**裸 div**（没有 `monaco-workbench` 类），所以**主题变量在根内是空的**、底色来自不依赖变量的规则——**真桥的宿主带那个类**（`vendor/vscode-embed/src/client/index.ts:486`），变量会解析，但那条要在 rig 上验。

## 实验 3：换主题时，逐根投放跟不跟得上（2026-10-05 已做，合成）

**问题**：VS Code 换主题是**原地改写**主题那张 `<style>` 的 `textContent`（`_applyRules`），逐根投放如果是"投一次"，就必然陈旧。

**做法**：合成页面里放源表 `<style id=theme>` + 规则表；两个影子根各建 `.monaco-workbench` 包装并把规则投进去，差别只在主题那一份——**A 死拷贝**（`cloneNode` 进根）vs **B 订阅**（根内自己一张 `CSSStyleSheet`，`MutationObserver` 盯源表改写后 `replaceSync` 重投）。然后原地改写源表（模拟切主题），看两边颜色。

**读数**：

| 做法 | 切换前 | 切换后（源表被原地改写） |
| --- | --- | --- |
| A 死拷贝 | `rgb(1, 2, 3)` ✓ | **`rgb(1, 2, 3)` ✗ 陈旧** |
| B 订阅 | `rgb(1, 2, 3)` ✓ | **`rgb(9, 8, 7)` ✓ 跟上** |

**结论**：**逐根投放必须是活的订阅，不能是一次拷贝**；而"观察到源表被改写"**不需要上游补丁**——`MutationObserver` 盯主题 `<style>` 元素就够（实测有效）。⇒ 先前担心的"换主题后逐根那份变旧"，在这条路上有零补丁的修法。

## 实验 4：真 rig、走 embed bridge（2026-10-05 已做）

**做法**：起独立实例（`prac-dev`，`:3084`；为写工作区外的 `~/.dsh` 提权一次），Playwright 打开带 token 的页面。**先要弄清怎么把 VS Code 那半弄上屏**（这本身是给以后省事的）：

- **默认状态没有 VS Code 视图在屏上**：`vscode:sidebar` 是"已放置、隐藏"（`listViews()` → `hidden: true`），编辑器 part 被**park 到屏幕外** `[-100000, 0, 800, 600]`（`createDetachedPart`），`#vscode-embed-boot` 仍是 `[0,1000,0,0]`。
- **把它调出来**：`globalThis.__pracLayout.show("vscode:sidebar")`（`place` 不用调，编排已经放好）。
- **真桥里视图的宿主是 `[data-vscode-embed-view]`**（explorer 走 `mountViewInto` 这条路），**不是** `[data-vscode-embed-part-host]`（那是整部件 `partHost` 那条）。宿主有真实几何 `[0,18,280,482]`，内含 `.monaco-pane-view` / `.pane` / `.pane-header`，214 个元素。

**读数**（把该宿主搬进影子根，逐根投放 15 张 `<style>` + `link`）：

| 配置 | 几何 | 逐像素差（对文档内同一 clip，134960 px） | 主题变量 |
| --- | --- | --- | --- |
| **① 宿主直接进根 + 逐根投样式** | `[0,18,280,482]` 不变 | **0**（`maxDelta 0`）⇒ **像素全等** | 空（根内没有 `monaco-workbench` 祖先） |
| **② 再在根内加 `.monaco-workbench` 包装** | 不变 | **134960 / 134960 全变，`maxDelta 700`** | 解析出来了（`#fafafd`） |

**⇒ 结论（这条最重要）**：**"加一个 `monaco-workbench` 包装来拿变量"在真 bridge 下是错的**——它会让**整条 workbench 作用域的级联重新命中**这个宿主，画面整体变样（全屏像素都变）。变量要另想办法投。

**替代做法（已单独验证）**：把变量块**以 `:host` 作用域**投进根（`CSSStyleSheet` 里写 `:host { --vscode-*: … }`）。合成对照：`:host` 投变量 → 后代解析到 `rgb(11,22,33)`、规则命中；不投 → 空、颜色错。**不引入包装类，级联不变。**

**所以逐根投放的配方是三件事**：① 规则表照原样投；② **变量块以 `:host` 作用域投**（不要用 `monaco-workbench` 包装）；③ **活的订阅**（实验 3）。

**两条挂载路，当前各有几个消费者（代码核查，2026-10-05）**：

- **视图路**（`viewHost` → `mountViewInto`，宿主 `[data-vscode-embed-view]`）：**当前组合里唯一活着的那条**——编排只注册了 `vscode:sidebar`（已放置、隐藏）。
- **整部件路**（`partHost`，宿主带 `monaco-workbench vscode-embed-part-host` + `[data-vscode-embed-part-host]`）：面在（`packages/client/vscode-host/src/client/index.ts:166`），但**当前组合里没有视图映射到 part**（编排里没有编辑器视图）⇒ **在 rig 里验不了，除非改组合**。它在**独立查看页**上有消费者（实验 2 就是走那条：页面自带 `[data-vscode-embed-part-host]` 宿主）。
- 两条路的差别要在实现时记住：**部件宿主自带 `monaco-workbench` 类**（lib 做的镜像），**视图宿主是裸的**（实验 4 的链上可见）——`monaco-workbench` 恰好是实验 4 里"包装类会唤醒整条级联"的那个开关，所以两条路上"变量怎么投"可能不一样。

**报错**：两条都是已知噪声（`@vscode/native-watchdog` 缺原生模块、github 认证提供方超时）。

## 实验 5：在真 VS Code 页面上实跑一次「换主题」（2026-10-05 已做）

**做法**：独立查看页（起在 `:5199`）。找到定义 `--vscode-*` 的那张表——**`<style class="contributedColorTheme">`，里面 1013 条变量**；挂一个 `MutationObserver`，然后**原地改写它的 `textContent`**（把侧栏底色变量换成一个显眼的红）——这就是 `_applyRules` 干的事。

**读数**：`.monaco-workbench` 上的 `--vscode-sideBar-background`：`#f8f8f8` → **`rgb(200, 30, 30)`**；**`MutationObserver` 触发 1 次**。

**⇒ 两条确认**：① 真页面上主题确实落在**一张 `<style class="contributedColorTheme">`** 里，换主题是**原地改写**；② 订阅这条路在真页面上**看得见改写**（实验 3 的合成结论在真页面成立）。

**一条要记住的坑**：我改的那个变量**没有让侧栏部件的画面跟着变**（部件底色仍是 `rgb(248, 248, 248)`）。⇒ **「变量解析对了」不等于「画面跟着变」**：一个部件用不用那个变量、用哪个、有没有硬值/回退值，是**规则的事**。所以换主题这条最终要在 rig（或实现之后）按**画面**验，而不是按变量值。

## 实验 6：整部件路的配方 + 换主题的“画面”（2026-10-05 已做，独立查看页）

### 6A：用库真实的宿主形状验配方——**过**

把侧栏宿主**先改成库的形状**（`partHost` 会给宿主加 `monaco-workbench vscode-embed-part-host` + 主题类；我手动加上，因为独立查看页的宿主是页面自带的裸 div），再搬进影子根，投放：**规则照原样**（15 张 `<style>` + 1 张 `link`）+ **变量以 `:host` 作用域**（声明抽自真主题表）。

**读数**：几何 `[48,30,260,568]` 不变；**逐像素差 0 / 147680**；宿主上变量解析出来（`#f8f8f8`）；无报错。⇒ **配方对两条路都成立**。

### 6B：换主题的“画面跟不跟”——**比想象的难，而且这次在文档里就复现了**

真页面上有**两张**变量表：

| 表 | 变量数 | 定义 `--vscode-foreground` / `--vscode-sideBar-background` |
| --- | --- | --- |
| **`<style class=“contributedColorTheme”>`** | **1013** | **是**（这张是主题） |
| 另一张（无类名） | **2284** | 否 |

在**文档里**（不涉影子）改写 `contributedColorTheme` 里的 `--vscode-foreground`：`.monaco-workbench` 上的变量**确实变了**（`rgb(30,30,30)` → `rgb(200,30,30)`），**但树里那个节点渲染出的颜色没变**（前 `rgb(30,30,30)`、后仍 `rgb(30,30,30)`）。

⇒ **“变量对了 ≠ 画面跟着” 在文档里就成立**——不是影子域带来的问题。所以换主题这条**必须按画面验**（真的切一次主题，或实现之后端到端验），**poke 变量不算**；也说明主题切换牵动的不止那一张表（1013 与 2284 两张并存，参与者规则还会直接落色）。

**附带一条操作教训**：我在实验 5 / 6 里先后“以为找到了主题表”而改错了表（一次改了 `:root` 那张 2284 的，画面对不上）——**认表要认类名 `contributedColorTheme`**，别按变量数挑。

## 落地：隔离的第一步（2026-10-05 已做）

**做了什么**：`packages/client/ui-layout` 里新增 `isolation.ts`，`frame.ts` 在**两个**视图渲染点（stack 的 body 与非 stack 的 viewBody）把视图包进 `IsolatedView`：宿主元素挂影子根，视图的树经 `react-dom` 的 portal 渲染进去。

**`isolation.ts` 投什么**（这是“影子根里缺什么”的清单）：

| 缺什么 | 怎么补 | 依据 |
| --- | --- | --- |
| 样式表（document 的规则不作用于影子树） | 逐根克隆 `head` 的 `style` / `link[rel=stylesheet]`，**活的**（`MutationObserver` 盯 head 的插入与原地改写） | 实验 1 / 3 |
| 属性选择器（`[data-ds-dark-theme] …` 选的是影子外的祖先） | 根内一个包装元素**镜像 document/body 的属性** | 代码核实（`ThemePresenter` 把令牌写成 body 内联属性、深色靠 body 属性选择） |
| 尺寸规则（`[data-prac-region] > *` 只管到宿主） | 根级 `:host` + 内容填充规则 | 现有 FRAME_STYLES |
| 自定义属性 | **不需要投**：它们继承 | 实验 1 |

**`react-dom` 是平台词**（DSH 的平台表里有），放进 catalog / 包的 devDependencies / `clientPack` 的 `external`——内联它等于在同一批根后面放第二份 React DOM。产物体积核对：`dist/client.js` 从内联时的 959 kB 回到 **57 kB**，且 `check:client` 报 `externals [… react-dom …]`。

**真页面验证（rig `:3084`）**：2 个视图宿主、各自有影根、**每个根里镜像了 122 个样式节点**、根级样式在位；DSH 侧栏与对话视图正常渲染（截图 `.build/scratch/iso-verify.png`），文本色是 DSH 的令牌色而不是浏览器默认；无新增报错。

**闸门**：prac 侧 `verify:stack`、`verify:persistence` **仍绿**（它们读的是 frame 自己的 light-DOM 属性）；**vendor 侧 `verify-views` 红 10 条**——正是“契约的消费者”那条老账：`fileMovedIntoTheTrack`、`paintedAfterHideAndRecall`、`splitEditorPaintedInNewPane` 等**按轻 DOM 查视图内部**（`.monaco-editor` / `.pane` / `[data-vscode-embed-part-host]`），而这些东西现在在影根里。⇒ **下一步是把闸门改成穿透影根**（不是设计变更，是消费者的迁移）。

## 落地：闸门穿透影根（2026-10-05 已做）

隔离一上线，vendor 侧 `verify-views` 红 10 条——**契约的消费者**那条老账。处置：新增 `vendor/vscode/scripts/deep-dom.mjs`，把“穿透影根”做成**一个**东西，六个 vendor 闸门改用它：

| 原来的写法 | 为什么在隔离下失效 | 改成 |
| --- | --- | --- |
| `document.querySelector(All)` | 视图内容在影根里 | `__deep.one` / `__deep.all`（轻 DOM 优先、再进影根——是等价的超集） |
| `host.closest("[data-prac-region]")` | `closest` **不跨**影根边界，region 归属读成 null | `__deep.closest`（沿 `getRootNode().host` 向上走） |
| `region [data-slot=…]` 后代选择器 | 后代关系跨不过边界 | 先 deep 找到元素，再 `__deep.closest` 读它在哪个 region |
| `page.waitForSelector` 等视图内容 | 同第一行 | `waitDeep`（`waitForFunction` + deep 查询） |
| 隐藏某元素来归属像素 | 同上 | `__deep.hide` |

**walk 的安装方式**：`addInitScript` + 立即 `evaluate` 各一次——`verify-file` 会重载页面，只 `evaluate` 会在重载后丢掉（实测踩到）。定义的是一个命名空间全局，对应用是惰性的。

**复跑（rig `:3084`）**：`verify-layout` · `verify-views` · `verify-focus` · `verify-regions` · `verify-view` · `verify-file` **六门全绿**；`verify-extension` 仍是条件门（需要真装一个扩展）；prac 侧 `verify-stack` · `verify-persistence` · `verify-bottom` · `verify-split` **四门全绿**。`vp check` 0 errors、警告回到基线的 3 条。

## 落地：adaptor（第三步，2026-10-05 已做）

新增 `vendor/vscode-embed/src/client/theme-root.ts`：**把应用的主题变量投进宿主所在的根**。

- 取 `.monaco-workbench` 那条规则的**声明**（经 CSSOM，优先认类名 `contributedColorTheme` 那张表），以 **`:host` 作用域**写进根里的一张自有 `<style>`；
- **订阅**：`MutationObserver` 盯 head（含原地改写）→ 重新取声明、重写那张表；一个根一张表，幂等；
- `deliverThemeToHost(element)` 只在 `element.getRootNode() instanceof ShadowRoot` 时动手——独立查看页那种没有根的场合不需要投递（它本来就继承文档的主题）。

**同时去掉旧机制**：`partHost` 的 **200ms 轮询**与**类镜像**（`monaco-workbench` + 主题类）删除。理由在隔离之后是结构性的：影子树里的选择器**只能靠 `:host` 命中边界元素**，所以 `.monaco-workbench …` 那套规则在根内根本匹配不到宿主，镜像类名已经不起作用。

**重建**：`vendor/vscode-embed` 是**源码形态**（被消费方构建期内联），所以重建了内联它的三个客户端包（`vscode-host`、`ui-vscode-editor`、`ui-vscode-explorer`）加 `ui-layout`，三份 `check:client` 全 `ok — loader(…)`。

### 真的切一次主题（rig `:3084`）

用 VS Code 自己的命令面（`__vscodeEmbed.commands.executeCommand`）执行 `workbench.action.toggleLightDarkThemes`，量借用件所在的那个根：

| | 切前（light） | 切后（dark） |
| --- | --- | --- |
| workbench 类 | `… vs …2026-light…` | `… vs-dark …2026-dark…` |
| 根内 `--vscode-sideBar-background` | `#fafafd` | **`#191a1b`** |
| 根内 `--vscode-foreground` | `#202020` | **`#bfbfbf`** |
| 该视图 clip 的像素 | — | **83.5% 变化，maxDelta 675** |

⇒ **两条都成立**：主题表被原地改写后，根内那份**跟上了**（订阅有效）；而且**画面跟着变了**（借用件从浅色切到深色）。实验 6B 的那个警告（“变量对了 ≠ 画面跟着”）在这里得到澄清：**真的切一次主题**时画面会跟；6B 之所以没跟，是因为它只 poke 了一个变量。

**闸门**：vendor 六门（`verify-layout` / `verify-views` / `verify-focus` / `verify-regions` / `verify-view` / `verify-file`）在 adaptor 之后**仍全绿**。

## 实验 7：CSS 锚点定位跨不跨影根边界（2026-10-05 已做，合成）

**为什么问**：`patches/0002` 的存在理由是“锚点定位跨不过 `.monaco-workbench` 子树边界”，于是把 webview 的浮层挂到 `document.body`。隔离之后那条边界变成了**影根边界**，而 `document.body` 在根的“外面”。

**做法**：三个对照——① 锚点与浮层同在文档；② 同在同一个影子根；③ 锚点在影根里、浮层在文档里（给锚点一个只有“真解析”才会出现的位置）。

**读数**：

| 情形 | 浮层 box | 判定 |
| --- | --- | --- |
| 同在文档 | 锚点底边处 | 解析 ✓ |
| 同在影根 | `[340, 455]`（＝锚点底边、左对齐） | 解析 ✓ |
| **锚在影根、浮层在文档** | **`[0, 0]`** | **不解析 ✗**（回落到 static） |

⇒ **CSS 锚点定位不跨影根边界。** 两个后果：

1. **`patches/0002` 那处修法在隔离下不再成立**：把浮层挂到 `document.body`，对“锚点在某个视图根里”的 webview 来说等于锚点消失（`[0,0]`）。
2. **“借用件的浮层一律搬进悬浮层”这条要附带一个条件**：悬浮层是**另一棵树**，所以搬过去之后**不能靠 CSS 锚点定位回锚点**——要么由**框架按锚点矩形摆位**（设计里那句“锚点是一个位置参数”，正好就是为这个），要么让该浮层**留在视图自己的根里**（同树才能用锚点定位）。

**④ 因此有两个可选做法**（需要裁）：

- **甲：框架按锚点矩形摆位**。adaptor 把锚点的**布局坐标矩形**交给框架，框架在悬浮层里创建并摆好那个窗口。通用（菜单 / 悬停 / 命令面都走它），代价是要有坐标空间与“锚点失效/跟随”规则，且**跨根几何要自己算**。
- **乙：按“这个浮层属于谁”分**。webview 这类**自带浏览上下文**的浮层留在**它自己的根**里（同树、锚点能用，且它本来就是自成体系的内容）；只有**框架级**的面（命令面板、通知）进悬浮层——那类不需要回到某个视图内的锚点。

## ④ 的边界由 James 划定：按作用域分（2026-10-05）

原话：**“如果悬浮只停留在 view 内部，这种情况下不需要框架管，view 可以自闭环。框架接管的是全局统一的悬浮，它不在 view 中，如阻止整个应用的模态框”**

⇒ 判据不是“归谁”，是**作用域**：

| 浮层 | 归谁 | 依据 |
| --- | --- | --- |
| 只停在视图盒子内部（webview 的 overlay、视图自己的悬停 / 局部菜单） | **视图自己**（自闭环） | 同树才能用 CSS 锚点定位（实验 7） |
| **全局、不在任何视图里**（阻止整个应用的模态框、命令面板、通知） | **框架**（悬浮层里的窗口） | 它不该被任何视图的盒子裁掉 |

**这条把 ④ 里那两个“甲 / 乙”选项合成了一句话**：不需要“框架按锚点矩形摆位”那条通用通路来解决 webview——它压根不进框架；也不需要为借用件另开一条边——它只在全局的面（命令面 / 通知）上才交给框架。

**仍待做的（⑤ 之外）**：

1. **`patches/0002` 要改指**：它现在把 webview 的 overlay 挂到 `document.body`（补丁注释写的理由是“锚点跨不过子树边界”）。隔离之后这条理由从“子树”变成“影根”，而 `body` 在根外 ⇒ **挂在那里锚点必然失效**。新目标：**挂进锚点所在的那棵树**（视图自己的根）。
2. **验证入口已经就绪**：`~/.local/share/prac/code-server/extensions/prac.probe-webview-1.0.0` 还装着，可以拿它把“0002 现在是否真的坏了”变成实测。

## ④ 落地：把 `patches/0002` 改指到“锚点所在的那棵树”（2026-10-05）

**改法**（`.build/vscode/src/vs/workbench/contrib/webview/browser/overlayWebview.ts`）：

- 新增 `private attachOverlay()`：取 `this._anchorState?.anchorElement`，**把 `overlayLayout.root` 挂进 `anchor.getRootNode()`**（若是 `ShadowRoot` 就挂进那个根，否则回落到 `document.body`）；只在父节点不同时才搬，避免反复重挂（webview 不能重挂，会毁内容）。
- 调用点两处：`overlayLayout` 懒创建时（原来那处 `document.body.appendChild` 换掉），以及 **`setAnchorElement`**（锚点可能比 layout 晚知道，此时要重新安放）。

**证据链**：补丁注释里原来写的理由是“锚点跨不过 `.monaco-workbench` 子树边界”；隔离之后那条边界变成**影根**（实验 7 量到：锚点在根里、浮层在文档里 → `[0,0]`）。所以 `document.body` 这个落点**必然失效**，新落点就是“锚点所在的那棵树”。

**补丁**：重新生成，57 行（+33/−3）；`git apply --check -R` 通过（build 会识别为“已在位”）。

**第一次验证没跑到位（如实记）**：web 产物已重建（`vscode:build` 通过，web + reh），rig 也起了，但**探针视图没被展开**——`prac.probe-webview` 贡献的是 `explorer` 容器里的一个 **webview 视图**（`pracProbeWebviewView`，`type: webview`），把 `vscode:sidebar` 提上来只看到 explorer 的树（280×133），**没有 overlay**（实测 `overlayCount: 0`；页面上唯一那个 iframe 是 0×0 的 services 页）。⇒ **第二次尝试（点开 pane）也没成**：侧栏里只渲染了**文件树**那一个视图（`viewHosts: [{ id: "workbench.explorer.fileView", box: [0,18,280,133] }]`），`.pane-header` 只有 "prac-dev" 一个，**扩展贡献的 `pracProbeWebviewView` 没出现**；整页 `overlays: []`（没有可量的 overlay），唯一的 iframe 是 0×0 的 services 页。⇒ **卡在"怎么让一个 webview 视图真的上屏"上，不是卡在补丁本身**。两条可走的路：① 查 `prac.probe-webview` 为什么不上屏（启停策略 / 激活条件 / 该容器只显示了文件树）；② 换 cSpell 的 `cSpellInfoView`（`type: webview`，但它的 `when` 要命令面板，而命令面板在 0×0 修复前不可用）。对照图 `.build/scratch/webview-overlay2.png`，脚本 `.build/scratch/webview-overlay{,2}.mjs`。

### 第三次：直接调 embed 的 face 挂进去 —— **验过**

**为什么前两次不成**：prac **只挂它枚举的视图**——`PART_OF_VIEW` 把 `vscode:sidebar` 映射到**单个视图** `workbench.explorer.fileView`（`packages/client/vscode-host/src/client/index.ts:61`），所以扩展贡献的 `pracProbeWebviewView` 从来不会被挂载，侧栏里当然没有它的 pane、也没有 overlay。**不是启停策略、也不是激活问题**（策略文件都不存在）。

**做法（不改产品）**：在真页面里拿 `globalThis.__vscodeEmbed.face.mountViewInto("pracProbeWebviewView", box)`，把那个 webview 视图**直接挂进一个视图自己的根**（放进它的 `[data-prac-view-content]`）。

**读数**：

| 量 | 值 | 说明 |
| --- | --- | --- |
| overlay（`.webview-overlay-content`） | `[0, 870, 260, 130]`，**tree = shadow** | 落在**根里**，不再是 `document.body` |
| 锚点（`.pane-body`，带 `anchor-name: --overlay-anchor-…`） | **同一 box** `[0,870,260,130]`，tree = shadow | 与 overlay **完全重合** ⇒ **锚点解析成功** |
| overlay 里的 iframe | 同 box，tree = shadow | webview 内容落在正确位置 |

⇒ **判据成立**：改指之后 overlay 与它的锚点**同树**、位置**逐像素重合**；而实验 7 已量到“不同树时锚点给 `[0,0]`”。**`patches/0002` 这条改动验过。**

对照图 `.build/scratch/webview-overlay3.png`，脚本 `.build/scratch/webview-overlay3.mjs`。

**已确认的部分**：补丁重新生成且 `git apply --check -R` 通过；`vp check` 0 errors。

## ⑤ 落地：角色 `sidebar` → `leftbar`（2026-10-05）

**只改 prac 自己的那层词**（`RoleBindings`）：`contract.ts`（角色接口与注释）、`services.ts`（`roles.leftbar`）、`arrangement.ts`（`ROLES = { leftbar: DSH_SIDEBAR_VIEW, rightbar: … }`）、`arrangement.spec.ts` 的断言、`ui-layout/client/index.ts` 的文档例。

**没改的（有意）**：`dsh:sidebar`（指 DSH 那个叫 `sidebar` 的槽）、`vscode:sidebar`、`workbench.parts.sidebar`、`SIDEBAR_PART` 常量名——**借来的名字**。**区域 id 也没改**（`left`/`right`）：它们进持久化、被闸门读，改名要升 key ⇒ **待裁**。

**验证**：单测 ui-layout **44/44**、web-app **15/15**；重建 `ui-layout` 类型产物与 `web-app` 包后，rig 上复跑 **十门**：prac 四门（stack / persistence / bottom / split）与 vendor 六门（layout / views / focus / regions / view / file）**全绿**。

## ④ 续：悬浮层也进隔离根——**试了，红了，已回退**（2026-10-05）

按裁定的 (a)（悬浮层的条目也是视图、照隔离）动手：`frame.ts` 里把 `renderSlot("shell.overlay", {})` 包进 `IsolatedView`，并给它一个 `clickThrough` 变体（宿主 `pointer-events: none`），同时在 `isolation.ts` 的根级规则里给内容的直接子元素补回 `pointer-events: auto`——因为轻 DOM 那条 `[data-prac-overlay-layer] > *` 在根里匹配不到。

**结果：`verify-views` 红**——`the file view is not a row in the recall catalogue`：写在 `shell.overlay` 里的 recall 面**没有渲染出它的行**（闸门的 deep 查询也找不到）。prac 侧 `verify-focus` / `verify-stack` / `verify-persistence` 仍绿。

**处置：回退**（`git show HEAD:<path>` 逐文件恢复——`git checkout` 要写 `.git`，被沙箱拦；重建 `ui-layout` 后 `verify-views` **恢复绿**）。

**代码排查的结果（候选②被排除）**：`RecallSurface`（`packages/bundle/web-app/src/client/index.ts`）**不依赖帧的轻 DOM**——它的行是 `views = layout.listViews()` 映射出来的（`rows = views.map(...)`，`data-prac-recall-row`），没有任何 `document.querySelector` / 量尺寸 / 找兄弟。所以"换树之后拿不到"这条不成立。

**剩下的候选（更要紧的是时序）**：那个面的**开合键监听是在它自己的 `useEffect` 里注册**的；而 `IsolatedView` 的 children **第一次渲染是 `null`**（等内容容器就绪才 portal），于是 `RecallSurface` 比原来**晚一拍挂载**⇒ 若按键早于它挂载，toggle 落空、目录行就是空 → 正好是闸门报的那个症状（`the file view is not a row in the recall catalogue`）。

### 结论（2026-10-05 探针）：**功能是好的，红的是闸门**

重新应用 (a) 后按键实测：根内 `recall: 1`、**rows: 4**、122 张镜像样式、宿主 `pointer-events: none`、**无 pageerror** ⇒ 悬浮层进隔离根**渲染正常**。

闸门仍红的原因查到了：**`verify-views` 里还留着轻 DOM 读取**——`[...document.querySelectorAll(rowSelector)]` 与 `document.querySelector("[data-prac-recall-selected]")`。`sample()` 里还有一串（`[data-prac-recall]` / `[data-prac-focus-strip]` / rows / region 控件）。**这个文件是我上一轮批量转换时漏掉的**（当时只给它单独补了几处），所以在悬浮层搬进根之后它找不到那些元素。

**修法**：把 `verify-views` 也整体换成 `__deep`（与其余六门一致）。改完 **`verify-views` 绿**，其余九门（vendor 五 + prac 四）**全绿**。

**教训（与我自己的上一轮有关）**：批量替换要**枚举文件**，漏掉一个就会把"功能坏了"与"消费者没跟上"混淆——这次正是靠一条探针把两者分开的。

**若那条也不成立**：就把"悬浮层是框架 chrome、不隔离"作为一条明确例外写进 note（像 `sash` 那样单列一类）。

## ⑤ 续：角色改用平台名 `primarySidebar` / `secondarySidebar`（2026-10-05）

James 给的上游事实：**VS Code 里区域 id 是 left / right；sidebar 的角色是 Primary / Secondary Side Bar**（核对：`viewQuickAccess.ts:154` 的 localize 就是 "Secondary Side Bar"，配置键 `workbench.secondarySideBar.*`；而 `workbench.sideBar.location` 让 primary 侧栏**可以换边**）。

⇒ **位置 ≠ 角色**：上一轮我自造的 `leftbar`（按位置命名）方向对、选词错。这次改用平台的角色名，并把 `rightbar` 一并改成 `secondarySidebar`（消掉最初的不对称）。改动范围与上一轮相同（`RoleBindings` / `services` / `arrangement` / `spec` / 文档例）。

**区域 id 不动**（`left` / `right`）——位置词、与上游一致，改名要升持久化 key 且没有收益。

**同时记下不继承什么**：上游布局树里的大半（activity bar 及其 position、sidebar 的 tab 套 stack、Panel 的四周位置）分别属于**内容 / 角色 / 摆放**——内容留在盒子里、角色借名、摆放用"把视图搬到别的区域"解决（不需要 `panel.position` 这个概念）。

**验证**（闸门已复跑）：单测 ui-layout **44/44**、web-app **15/15**；`vp check` 0 errors；链接 0 断；rig `:3084` 上**十门全绿**——vendor 六（layout / views / focus / regions / view / file）+ prac 四（stack / persistence / bottom / split）。

## 整部件路（`partHost` / `movePartInto`）在 rig 里补验（2026-10-05）

之前记的缺口是：当前组合**只注册了 `vscode:sidebar`（映射到单视图 `workbench.explorer.fileView`）**，没有视图映射到 **part**，所以整部件路在 rig 里没有消费者。

**做法（不改产品）**：真页面里直接调 embed 的 face——`__vscodeEmbed.face.movePartInto("workbench.parts.sidebar", box)`，box 放进一个**视图自己的隔离根**的内容容器里。

**读数**：

| 量 | 值 |
| --- | --- |
| 宿主所在的树 | **shadow**（视图的隔离根里） |
| `.part` 是否在 | **在**，类名 `part vscode-embed-part sidebar left pane-composite-part …` |
| 盒模型 | 宿主 `[0,705,300,295]`、part 在盒内 `[0,719,300,260]` |
| 上屏 | `background rgb(248,248,248)`、`color rgb(59,59,59)`（浅色主题色），内含 1 个 composite/header |
| 无 pageerror | 是（只有既有的 watchdog / github 认证噪声） |

⇒ **整部件也能住进隔离根并正常上屏**。**一处如实说明**：这条探针**绕过了 lib 的 `partHost` 包装**（它才是加 `monaco-workbench` 类并调 `deliverThemeToHost` 的那层），所以宿主的 `--vscode-sideBar-background` 读出来是**空**——那层包装的**形状**另有实验 6A 验过（宿主带 `monaco-workbench` 时像素零差），主题投递则与视图路**同一段代码**（已在 rig 上按“真的切主题”验过）。

对照图 `.build/scratch/part-path.png`，脚本 `.build/scratch/part-path.mjs`。

## 还没落地的

- ~~**adaptor（第三步）**~~ → **已做，见下“落地：adaptor”**；旧的描述留档：：`vendor/vscode-embed` 的 `partHost` / `viewHost` 现在仍带**旧机制**——类镜像（`monaco-workbench` + 主题类）与 **200ms 轮询**。这一步要做的是：
  1. **把主题变量投进宿主所在的根**：取 `.monaco-workbench` 那条规则的**声明**、以 `:host` 作用域投进 `host.getRootNode()`，并**订阅**主题表的原地改写（实验 3 的零补丁修法）。
  2. **去掉类镜像与轮询**：隔离之后 `.monaco-workbench` 作用域的规则在根内**匹配不到宿主**（影子树里的选择器只能靠 `:host` 命中边界元素），类镜像已不起作用。
  - **一条实测底牌（降低风险）**：实验 4 / 6B 里，变量在根内是**空的**而渲染仍正确——部件的颜色来自字面值或回退值。所以画面暂不依赖这条投递；它服务的是**换主题时借用件跟不跟**（实验 6B 说这条要按画面验）。
  - **验收**：重建 `vendor/vscode-embed` **以及构建期内联它的 prac 客户端包**，rig 上复跑十门 + 一次“真的切主题看画面”。
- ~~**浮层归悬浮层（第四步）**~~ → **边界已定**：按作用域分（见上）；剩下的是把 `patches/0002` 改指到“锚点所在的那棵树”，并用 `prac.probe-webview` 验一次。
- **`leftbar` 改名（第五步）**：设计层已定；落地会牵动 `arrangement.ts` / `catalogue.ts` / `contract.ts` / `vscode-host` 与**闸门**（它们按 view id 选宿主）。
- **`docs/architecture.md` §3.1 与 umbrella §3.5 仍是旧口径**（"借来的组件是沙箱里的客人"；"tab 与分栏由 stage 提供"）。它们是**现在时文档**，改它们等于把这批裁决落成正式设计 ⇒ **等 James 点头**。同批要清的还有"沙箱"这个撞词（它在本仓另指 agent 运行时的执行沙箱）。
