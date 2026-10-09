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
6. **一个文件可以同时住在多个区域**（VS Code 的 Split Editor 语义）：所以**身份是"放置"，不是文件**。能力按组报条目（`resource / group / region / active / dirty / preview`），同一个文件在两处就是两条；prac 侧为每条建自己的视图，落位由条目给的 `region` 决定。两条由此确立的边界：
   - **视图 id 的键是区域（放置），不是组**。prac 里组是区域的（一个区域一个组），而视图可以在区域之间移动；用组做键时，同一文件的两次放置会共用一个组、其中一个视图拿不到面（实测：`a.txt@stage` 与 `a.txt@region-2` 两个视图，只有一个有面）。用区域做键则"移动"就是旧视图消失、新视图出现，宿主那边"把编辑器搬过去"才有唯一判据。
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
- **身份改造是一整块，四件必须一起动**（机制侧已经能按放置报条目；这四件分着改会留下半迁移）：① 视图 id 改成 **(区域, 资源)**；② `prac-client-vscode-host` 的目录从"每个打开文件一条"变成"每个放置一条"（数据源换成 `capabilities.editors.snapshot()`，条目带 `region`；`onDidChangeCatalogue` 还要订阅 editors 能力，否则"同一集合里换组"不发事件）；③ arrangement 按条目给的 `region` **安静落位**，注意力不再搬文件视图（见 Proposal 第 6 条的第二条边界）；④ 宿主区分"第二个放置"与"视图搬家"：前者**不许**动另一个组里的编辑器，后者要搬——判据是"这个文件还有没有别的放置"，那在客户端。随之要重定的是 tab 条（一个文件可能在两处出现两个 tab）、"当前文件"的概念，以及关闭/脏标记按放置算还是按文件算。
- **`addGroup` 的落地形状**：host → app 的一条请求（"为这个组创建一个区域"）+ `layout.splitView` 接受宿主指定的 region id（现在自己生成），否则 `addGroup` 返回的组与真实区域对不上。`findGroup` 的方向型位置（LEFT/RIGHT/UP/DOWN）同样等这条通道：几何只有 frame 有。

## 侦察结果（2026-10-07，探针跑在真 rig 上）

1. **`EditorGroupModel` 能独立构造**（`instantiationService.createInstance(EditorGroupModel, undefined)`）——不需要组视图。
2. **`EditorPanes` 与「组的进度指示器」需要一个"组的作用域"**，跟 `EditorGroupView` 建的一样：`ProgressBar` + scoped `IContextKeyService` + **组级的 `IEditorProgressService`**（`EditorProgressIndicator(progressBar, group)`——它**不是**全局单例，第一版探针就死在 `UNKNOWN service editorProgressService`）。⇒ 嵌入式服务图里这层 scope 要我们建。
3. **面板会反过来向组要素成员**：`EditorPanes` 源码只用到 `windowId` / `openEditor`，但真正跑起来时**面板自己**（以及进度指示器）会调 `isEmpty`、`isPinned`、`onDidModelChange`（`textDiffEditor.ts` 里 `this.group.isPinned(input)`、`progressIndicator.ts` 里 `group.onDidModelChange`）⇒ 用一个"假组"喂 `EditorPanes` 是**死路**，**必须有一个真的 `IEditorGroupView`**。这正好把"要写什么"钉死：模型能转发的都转发给 `EditorGroupModel`，其余是我们自己的行为。

⇒ 下一步就是写这个类（`PracEditorGroup`），第一批成员先覆盖"能开一个文件并画出来"：`windowId` / `element` / `container` / `openEditor` / `closeEditor` / `isEmpty` / `isPinned` / `contains` / `activeEditor` / `activeEditorPane` / `onDidModelChange` / `onDidActiveEditorChange` / `layout` / `setVisible` / `focus`，其余按最小实现并进"未支持"清单。

## 判据（这一轮怎么算成立）

1. 转到符号 / 定义时，**可见编辑器真的动**（今天是离屏那份动）。
2. Outline、Timeline 与上游一致（同一份模型、同一个面板）。
3. **DOM 里不存在离屏部件**（`[data-vscode-embed-detached]` 消失），app 的打开路径（树点击 / 快速打开 / `openFile`）照常。
4. 现有五道 vendor 门 + 五道 prac 门全绿。
