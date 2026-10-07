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

**在 prac 里做"工作台的编辑器面板"的等价物，并把它接到编辑器服务**；**不留离屏部件**（James 2026-10-07：「它会成为沉重的债务」）。四件事：

1. **prac 当编辑器宿主**。复用上游的 `EditorGroupView`（面板、组、真生命周期都是上游那份），prac 只实现宿主三接口的**最小集**：
   - `IEditorGroupsService`（15 个成员，多是辅助窗口 / 工作集 / 模态部件的簿记）；
   - `IEditorPart`（8 个成员 + 继承 `IEditorGroupsView` 的 18 个）；
   - `IEditorPartsView`（10 个成员，同样是辅助部件的簿记）。
   其中需要**真行为**的十余个：组注册与查表、`activeGroup` 与激活事件、`addGroup`/`removeGroup`、`partOptions` 与变更事件、`onDidVisibilityChange`、layout 相关事件。其余（辅助窗口、工作集、组级网格动作）给最小实现，并在启动日志与门里**显式列出未支持**——不静默退化。
2. **一个文件视图 = 一个编辑器组**。组的 DOM 就长在 prac 的文件视图宿主里（像今天搬 part/view 那样搬组元素）；**可见性与几何归 prac 的 frame**（这正是 prac 的模型），组不再因为"不是活动编辑器"而被隐藏。
3. **面板类是 prac 自己的、但体验是上游的**：继承上游文本编辑器面板（`TextFileEditor` / `AbstractTextCodeEditor`），注册进 `IEditorPaneRegistry`（prac 自己的 editor id），由 `IEditorResolverService.registerEditor(工作区文件 glob, { id })` 解析到它。打开 / 关闭 / 脏 / 保存 / 视图状态仍全部走服务。
4. **目录不变**：`listOpenFiles()` 读的仍是编辑器服务的打开集合，编排照旧按文件落位。

## Alternatives（放弃了什么）

- **保留离屏部件**（今日形态）：James 否决——它是第二个世界，且会一直是债。
- **给离屏部件真实布局，再把组/面板的 DOM 搬进 prac 视图**：实测四种做法全失败（单组搬 control 被隐藏；每文件一组 + `openEditor(描述符, group)` 只有第一次成功且开成两份；`addGroup` + `moveEditors` 搬移返回 false；`SIDE_GROUP` 让 `openEditor` 返回 undefined）——根因是离屏部件是"单格网格"。即便修好，它仍是第二个世界。
- **prac 自己实现 `IEditorGroup`**：比复用 `EditorGroupView` + 自实现宿主大得多（组模型、面板生命周期、header/tabs 都要自己来），且会分叉上游行为。

## Open questions

- **组级的网格动作**（split / move / copy / merge group、maximize、arrange）：**映射到 prac 的区域操作**（prac 的"分栏"是区域的模式），还是**先明确不支持**？倾向后者，按需逐个映射——映射要小心两套层级的语义差异。
- **组头**（tab 条 + 面包屑）：tab 按决定 17 归 prac（已有），**面包屑挂在组头上**——搬组头会让两套 tab 重叠。倾向先把面板做对，面包屑单独裁一次。
- **未支持清单的表达**：放在启动日志、一条活体门，还是两者都要。

## 判据（这一轮怎么算成立）

1. 转到符号 / 定义时，**可见编辑器真的动**（今天是离屏那份动）。
2. Outline、Timeline 与上游一致（同一份模型、同一个面板）。
3. **DOM 里不存在离屏部件**（`[data-vscode-embed-detached]` 消失），app 的打开路径（树点击 / 快速打开 / `openFile`）照常。
4. 现有五道 vendor 门 + 五道 prac 门全绿。
