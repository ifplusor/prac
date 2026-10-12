---
status: in-progress
---

# Agent Note: prac 自己的编辑器宿主 —— 把"工作台的编辑器面板"做成等价物

## Problem

编辑器那一半现在有**两个世界**：

- **离屏的编辑器部件**（`embeddedWorkbench.ts` 的 `createDetachedPart("workbench.parts.editor")`）：挂在 `document.body`、`left:-100000px`，只为让编辑器服务活着。app 每打开一个文件，**在那里面**生成一个真正的编辑器面板。
- **prac 视图里的控件**：`mountFileInto()` 自己 `new` 一个 `CodeEditorWidget`，拿同一份文本模型渲染。

同一份模型上因此挂着两个控件（实测：可见的 `[285,21,890,734]`、离屏的 `[-100000,0,800,543]`，两者第一行都是同一个文件）。后果是**服务说的那块面不是人看的那块**：转到符号/定义、格式化、重命名这些**动作**落在离屏那份上（实测：可见编辑器停在 1–41 行，离屏那份跳到 605–636 行），挂在 `EditorInput`/`EditorPane` 上的贡献（面包屑 / peek / diff / 热退出）从来没上过屏。离屏部件本身还是债：一个没人看得见的子系统持有"开着哪些文件、哪个是活动编辑器"的状态，必须和 prac 的显示手工保持一致。

## Proposal

**在 prac 里做"编辑器面板 / 编辑器组"的等价物，并把它接到编辑器服务**；**不留离屏部件**（James 2026-10-07：「它会成为沉重的债务」），也**不用上游的 `EditorPart` 或 `EditorGroupView`**（James 2026-10-07：部件无法与 DSH 的视图结合；组是个只装编辑器的封闭世界，装不下 prac 视图）。要点：

1. **组是 prac 自己的对象，家在 prac 的区域里**。容器是区域的宿主，所以**同一个区域既能放 prac 视图（DSH 的、侧栏/面板的）也能放编辑器面板**——这正是不用上游组的原因，也是这条路成立的关键。
2. **上游那半照借**（省掉重写）：
   - `EditorGroupModel` —— 谁开着、顺序、活动、preview / pinned / sticky 的语义；
   - `EditorPanes` —— 面板的创建 / 生命周期 / DOM 搬运（实测它只向组要 `windowId` 与 `openEditor`，所以能装在**我们自己的**组对象上）；
   - 面板类 —— `TextFileEditor` / `AbstractTextCodeEditor` 那套编辑体验（注册成 prac 自己的 editor id，由 `IEditorResolverService` 按工作区文件 glob 解析到它）。
3. **我们要写的**：`IEditorGroupView`（= `IEditorGroup`，51 个成员，其中绝大多数是对 `EditorGroupModel` 的转发）+ 宿主三接口的最小集（`IEditorGroupsService` 15 / `IEditorPart` 8 + `IEditorGroupsView` 18 / `IEditorPartsView` 10）。需要真行为的十余个：组注册与查表、活动组与激活事件、加/删组、`partOptions`、可见性、layout 事件、上下文键的 `bind`。
4. **多组 + 分栏 = prac 的区域树**：一个载文件的区域 = 一个组（`stage` 是默认那个），拆区域 = 新组（与"分栏是区域的性质"一致）；只放侧栏 / 面板的区域没有组。
5. **目录与落位**：`listOpenFiles()` 照旧读编辑器服务的打开集合；文件在哪个区域 = 它在哪个组，"把文件搬去另一个区域" = 编辑器在组之间搬（`moveEditors`）。**文件不再由 frame 给每个文件一个宿主**——那是组的活；prac 的 tab 条仍然描述这个区域里的视图顺序。
6. **一个文件可以同时住在多个区域**（VS Code 的 Split Editor 语义）：所以**身份是"放置"，不是文件**。能力按 `(文件, 组)` 报条目（`placement / resource / group / region / active / dirty / preview`），同一个文件在两处就是两条；prac 侧为每条建自己的视图，落位由条目给的 `region` 决定。三条由此确立的边界：
   - **视图 id 的键是"放置令牌"**（`vscode:file:<placement>:<resource>`）。令牌由宿主在文件第一次出现在某个组时发放，**组随视图搬家时令牌不变**（下面第 ② 条），所以"移动"不会让消费者的名字变成陈旧的。用组做键会在每次移动时改名（实测：`splitView` 之后视图 id 从 `p0` 变成 `p2`，浮层与门都握着已经不存在的名字）；用区域做键则给不出 id——区域是挂载时才知道的，而 id 必须在挂载之前就有。令牌只在一种情况下重发：**编辑器被搬进一个已经有组的区域**（第 ③ 条）——上游的 `moveEditor` 先在目标组打开、再在源组关闭，而那前一半与"Split Editor 的复制"**是同一个事件**，宿主无从分辨，于是按新放置发放。代价是被移动的视图在新区域里是一个新 tab（追加在末尾，与 VS Code 移动编辑器一致），所以**消费者必须每次从目录重新读 id，不能缓存**。
   - **宿主的三条落位规则**（挂载时 frame 渲染的那个区域的元素给出 region）：① 放置的组已经在这个区域 ⇒ 只把组的元素搬进视图宿主（tab 切换、重渲染）；② 放置的组只装这一个文件、目标区域还没有组 ⇒ **组**随视图搬，编辑器连 pane 一起保留；③ 否则 ⇒ **编辑器**搬（上游 `moveEditor`，目标区域的组接手），留下来的视图各自保住自己的面。三种都只是"同一条令牌换了组"。
   - **一次 `focusin` 只代表"组正在显示的那个文件"**。打开编辑器会让 pane 拿到焦点，而 frame 还没换掉前一个视图宿主时，这个事件是从**旧宿主**里冒出来的；把它读成"人在这块区域工作"会把 app 的活动编辑器拽回刚刚让出中间的文件（实测：重开后新文件的视图没有面）。所以 `focusFile` 只在组的活动编辑器就是该放置的文件时才动作。
   - **目录事件按"放置"报**（`令牌 + 资源 + 组 + 区域` 的集合），**不是**每次编辑器变化都报：把"活动/脏"这类变化也接进目录，会让 arrangement 进入"活动编辑器"的对账回路——实测约 30 万次同步/秒，直到页面 OOM。
   - **注意力只在"有新文件出现"时把注意力拉回编辑器**；放置变化（一个视图换区域）不拉，否则人刚把编辑器停到轨道，下一秒就被拉回中间（实测：焦点门的整个停放阶段失败）。修正后停放阶段通过。
   - **放置权在工作台/组，注意力只管前后**。工作台说"这个文件的编辑器住在区域 X"，而 arrangement 的注意力模型说"当前文件占中间、另一个停到轨道"——一个文件一个视图时两者不冲突（arrangement 搬视图、编辑器跟着搬），多个放置之下必须收敛为：**文件住哪个区域由组决定；注意力只决定哪个区域在前**（落位用 `placeQuietly`，只有"当前放置"才前置）。
   编辑器在组间的搬/复制（工作台的 move/copy、Split Editor）就是"条目多一条/少一条"，视图跟着来去。
7. **`findGroup` 的位置语义**：FIRST / LAST / NEXT / PREVIOUS 是**顺序型**（组列表的两端与相邻），照上游 `editorPart.ts:385-412` 实现；LEFT / RIGHT / UP / DOWN 是**方向型**，要 prac 区域树的几何，只属于 frame，宿主同步答不出来 ⇒ 不答（调用方于是走 `addGroup`）。`addGroup` 反过来要"创建一个区域"，是 host → app 的请求 + 区域 id 由宿主指定，属未落地的一步。

## Alternatives（放弃了什么）

- **保留离屏部件**（今日形态）：James 否决——它是第二个世界，且会一直是债。
- **把上游 `EditorPart` 挂进 `stage`**：否决——**部件无法与 DSH 的视图结合**（当初把文件做成视图、把部件挪去离屏，正是为了绕开它）。
- **复用上游 `EditorGroupView`（一个区域一个组）**：否决——**组是只装编辑器的封闭世界，装不下 prac 视图**；区域的容器必须是 prac 的。
- **给离屏部件真实布局，再把组/面板的 DOM 搬进 prac 视图**：实测四种做法全失败（单组搬 control 被隐藏；每文件一组 + `openEditor(描述符, group)` 只有第一次成功且开成两份；`addGroup` + `moveEditors` 搬移返回 false；`SIDE_GROUP` 让 `openEditor` 返回 undefined）——根因是离屏部件是"单格网格"。即便修好，它仍是第二个世界。
- **prac 从零实现面板与模型**：不必——`EditorGroupModel` 与 `EditorPanes` 都以组对象为界，可以照借。

## Open questions

- **组头**（tab 条 + 面包屑）：tab 按决定 17 归 prac（区域的 tab 条已有），**面包屑挂在组头上**——是先让 prac 的 tab 条只做 tab、把组头其余部分搬进来，还是另行处理，单独裁一次。
- **未支持清单的表达**：放在启动日志、一条活体门，还是两者都要。
- **身份改造之后的三件事已定**（tab / 脏标记 / 关闭，"按放置"这一句裁决落在关闭上）：
  - **tab**：按放置（一个放置一个 `vscode:file:<placement>:<resource>` view，tab 由它所在的区域渲染）。
  - **脏标记**：按**模型**（资源）。VS Code 的脏是 `ITextFileEditorModel` 的属性，两个放置共享同一个模型 ⇒ 两个 tab 显示同一个脏点；按放置算会是假信息。
  - **关闭**：按**放置**。`close(placement, resource)` 一直接到 capability 上（`embeddedWorkbench` 在 `findEditors(uri)` 的结果里只取 `groupId === placement` 的那一个实例），tab 的 × 用 `host.filePlacement(view)` 报名。在飞行中的护栏也改成按放置（`closingFiles` 用 `placementKey`），只有"这个资源的每个放置都在关闭"才拦住 `activate`（`isClosingEverywhere`）——文件还在另一个区域里开着时，激活它是正当的。上游语义一致：关一个组不动另一个组。
  - **"当前文件"**：是"最前区域里处于 `activeEditor` 的那个**放置**"（区域最前由 prac 的 front 决定，组内 active 由 `EditorGroupModel` 决定）；`web-app` 现有的 `currentFile` 重挑就是它在用。
- **零延迟的 down+up 会让工作台的确认框重问一次 —— 已定性为合成输入的产物，不是产品缺陷**（`exp144`–`exp148` 量清）：按住 30ms 再抬起就正常（`mouseup` 目标就是 Cancel 按钮、对话框关闭并保持关闭）；而**零延迟**那一次的 `mouseup` 目标落在编辑器上。期间没有任何东西移动或改序 —— 对话框与按钮的盒不变（`exp144` `moved:false`）、覆盖层与 stage 的 DOM 顺序与 z-index 不变（`exp148`：`stageFirst`、层 `z-index:20`）、prac 的 layout 无变化、也没有 `focusin`（`exp146`）—— 所以既不是重排/重定位，也不是 attention 被浮层焦点驱动。`elementFromPoint` 在所有时刻都返回影子树**宿主**（无 class 的 DIV），用它判断"点在谁身上"本身就是错的。⇒ 门继续按人的节奏按（120ms），这条不再追。
- **`addGroup` 的通道（已通）**：在 prac，组就是区域，所以"加一个组"是**问 frame 要一个新区域**。face 的 `createRegionBeside(regionId, side)` 用 `splitRegionWith` 做纯树编辑（**不移动任何 view**），同步返回新区域 id；`PracEditorHost.addGroup` 拿它 + `ensureGroup(newRegion, newRegion)` 把新组绑到那个区域上。通道两端：workbench 面 `setGroupRegionFactory(factory)`（模块级持有 —— host 走 DI，没有应用回调的缝），应用侧在 `vscode-host` 安装 `(region, side) => ctx.pracLayout.createRegionBeside(region, side)`；`vscode-embed` 的门面会先把 factory 存下、等工作台面 publish 时补交（应用先于工作台面启动）。**实测**：单个组时 `workbench.action.splitEditorToNextGroup` 从"什么都不做"变成开出 `p1@region-2`。**仍未做**：方向型 `findGroup`（LEFT/RIGHT/UP/DOWN）需要一个区域树几何查找（`regionInDirection`），同样经这条通道回答。
- **浮层可交互，但门的"瞬时点击"不行**（2026-10-12 量清）：应用自己的浮层（快选、菜单、通知、模态）**是能点的** —— 转到符号的行用"按下 → 停 120ms → 抬起"能选中并让编辑器滚到目标行，脏文件关不掉的确认框同理（Cancel / Don't Save 都生效）。而 Playwright 默认的**零延迟** down+up 不给按钮 `click`（实测：对话框按下即消失、抬起落在编辑器上，随后对话框被重新问一次）。⇒ 这是**门的输入**问题，不是产品缺陷：门要按人的节奏按（已写进 `verify-close` 与 `verify-editor` 的注释）。此前一轮把 `document.elementFromPoint` 的结果读成"穿透到 body"是误判——它对影子树内容返回的是**宿主**，而"点不动"的真因是 DSH 那条 Preview Notice 的全屏 mask + `#root` 的 `inert`（见下一条）。
- ~~本仓库类型检查的 DSH 版本与运行的 DSH 不是同一个~~ **已定**：prac dev 的 DSH 锚点是一个 worktree（`../../deepseek-harness/dsh-prac-dev`），catalog 精确 pin 它的发布版本，`pnpm check` 里的逐字节比较与发布点的 `satisfies ILayout` 是两道防线 —— 见 `2026-10-12-dsh-anchor.md`。（这一条原本是「侦察结果」第 4 条那个 `panelInfo` 漂移的成因。）

## 侦察结果（2026-10-07，探针跑在真 rig 上）

1. **`EditorGroupModel` 能独立构造**（`instantiationService.createInstance(EditorGroupModel, undefined)`）——不需要组视图。
2. **`EditorPanes` 与「组的进度指示器」需要一个"组的作用域"**，跟 `EditorGroupView` 建的一样：`ProgressBar` + scoped `IContextKeyService` + **组级的 `IEditorProgressService`**（`EditorProgressIndicator(progressBar, group)`——它**不是**全局单例，第一版探针就死在 `UNKNOWN service editorProgressService`）。⇒ 嵌入式服务图里这层 scope 要我们建。
3. **面板会反过来向组要素成员**：`EditorPanes` 源码只用到 `windowId` / `openEditor`，但真正跑起来时**面板自己**（以及进度指示器）会调 `isEmpty`、`isPinned`、`onDidModelChange`（`textDiffEditor.ts` 里 `this.group.isPinned(input)`、`progressIndicator.ts` 里 `group.onDidModelChange`）⇒ 用一个"假组"喂 `EditorPanes` 是**死路**，**必须有一个真的 `IEditorGroupView`**。这正好把"要写什么"钉死：模型能转发的都转发给 `EditorGroupModel`，其余是我们自己的行为。

⇒ 下一步就是写这个类（`PracEditorGroup`），第一批成员先覆盖"能开一个文件并画出来"：`windowId` / `element` / `container` / `openEditor` / `closeEditor` / `isEmpty` / `isPinned` / `contains` / `activeEditor` / `activeEditorPane` / `onDidModelChange` / `onDidActiveEditorChange` / `layout` / `setVisible` / `focus`，其余按最小实现并进"未支持"清单。

4. **`ctx.layout` 是 prac 手抄的上游契约，上游加成员时我们静默地坏**（2026-10-12 实测）：上游的 `ui-sidebar-right` 在激活时读 `layout.panelInfo.getSnapshot().activePanelId`，而 prac 的 `LayoutFace` 没有发布 `panelInfo`（它只做了 `provideRoot({ hooks: { panelInfo } })`，没进 face）⇒ 该插件激活失败，**12 个条目不激活**（`sidebar-right` failed，其余 pending 在 `sidebarRight` / `sidebarRightTabs` 上），整个外壳起不来；唯一的报错是 `Cannot read properties of undefined (reading 'getSnapshot')`。修法：把它发布进 face。**为什么没有更早红**：本仓库的类型检查用的是已发布的 `0.1.5-rc.1`，而 app 跑的是 checkout（见 Open questions 最后一条）——两个 `ILayout` 不是同一个类型，`satisfies` 也就写不成。

5. **DSH 0.2 的「Preview Notice」会把整页 `inert`**（2026-10-12 实测）：它渲染在自己的 body root 里（全屏 mask），并把 `#root` 标成 `inert`，于是 prac 的界面**既不能点也不能聚焦**（Playwright 的 actionability 检查报 `<body> intercepts pointer events`；`#root` 带 `inert="true"`）。它不是任何门的题目，而"确认"是一次**持久的宿主设置**（属于人的 onboarding），所以门在跑的时候把那层 modal root 藏掉并清掉 `inert`（`scripts/shell-modal.mjs`，两族门共用），不代替人点确认。

## 判据（这一轮怎么算成立）

1. **编辑器动作落在可见的那块面上**：转到符号 / 定义（以及任何编辑动作）动的必须是 prac 展示的那份。**已锁，两个手势**：`vendor:verify-editor` 先在**转到符号**的快选里按下符号行（可见面的渲染行从 `// top-<token>` 变成 `// filler 182…`），再用**文件内查找**把它带回文件头（渲染行变回 `// top-<token>`），两次都断言宿主元素与区域不变。
2. **Outline / Timeline 与上游一致**（同一份模型、同一个面板）。Outline **已锁**（`vendor:verify-outline`：符号、跟随下一个文件、跟随取得焦点的区域、排在面板内）；**Timeline 未锁**——它需要一条 provider（git / 本地历史）才有内容可比，属未做。
3. **DOM 里不存在离屏部件**（`[data-vscode-embed-detached]` 消失），app 的打开路径（树点击 / 快速打开 / `openFile`）照常。**已锁**：`vendor:verify-editor` 断言 `[data-vscode-embed-detached]` 与 `[data-vscode-embed-part-host]` 计数为 0，同一文件的编辑面**恰好一个**。
4. **门全绿**：vendor `editor / file / views / outline / focus / tabs / close / layout / view` + prac `stack / split / containers / bottom / persistence`。过期的 `vendor:verify-regions`（断言"离屏部件存在"）**退役**：它的第 1 条并入 `verify-editor`，第 2–3 条（view host 落在区域内、pane 不越宽）并入 `verify-view`。
