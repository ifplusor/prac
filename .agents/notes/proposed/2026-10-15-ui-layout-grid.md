---
status: proposed
---

# Agent Note: ui-layout 升级到 grid（栈 → 叶子）

## Problem

**栈内高度有两个权威**：视图记录里的 `ViewRecord.size`（人拖出来的、以及折叠时记下的）与渲染期分配器**画出来**的值（`allocateStack`）。两者可以不一致，现场见过"布局里存 69、屏幕上画 519"。用户报的"上面的 item 会变"、折叠高度丢失、一条吞掉整块剩余，都是它的下游。

根因不是分配器写得不好，而是**栈里的条目不是布局的叶子**：

- `split` 的尺寸住在**树**里（一个权威，`resolveSizes` 一次算完）；
- `stack` 的尺寸住在**视图记录**里，再由渲染期一个分配器算成画面高度（第二个权威）。

另一条独立的诉求指向同一个方向：**stage 要有上游 editor part 那种调整尺寸的灵活性**（同轴重新分配、中心最后让位、拖到边缘收起）——那些能力上游都长在 `Grid` 的叶子上（`minimum/maximumWidth/Height`、`priority`、`Sizing`、edge snapping）。

## Proposal

把状态对齐上游 `Grid` 的序列化形状（`ISerializedGrid = { root, orientation, width, height }`；节点是 `branch` / `leaf`），让**栈变成树的结构**：

| prac 现在 | 目标 | 说明 |
| --- | --- | --- |
| `SplitNode{dir, children[], size, flex?}` | `branch{orientation, data[], size}` | 同构：改的是名与字段，不是结构 |
| `RegionNode{id, size, flex?, min, collapsed?, children?}` | `leaf{data: regionId, size, visible?, maximized?}` + 该视图的 `min` / `max` / `priority` | 区域仍是叶子；`min` 有、**`max` 缺** |
| 区域 `stack: true` + n 条视图 | 一个 `column` branch + n 个 leaf（每条一个只住一个视图的 region） | **这次改动的核心** |
| `ViewRecord.size`（栈内高度） | **删除**；高度只在 leaf 上 | 两个权威合一 |
| `ViewRecord.collapsed` | `leaf.visible = false`，且该 leaf 的 `size` / `min` = 标题高 | 折叠仍是"只剩标题"，但由树表达 |
| `flex?: boolean` | `size` + `min` / `max` + `Sizing` | `flex` 是 prac 自造的概念，改用上游的"分配 / 扩展" |

**要补的语义**：每叶 `min` + `max`；`priority`（中心 `LayoutPriority.High`，空间紧张时最后让位）；`Sizing`（`Distribute` 同轴重新分配 / `Expand` 只推邻居）；sash 的 **edge snap**；可选 `maximized`。

**删除清单**：`allocateStack`、`redistributeOnDrag`、`dragChainTarget` 的**实现**随栈消失而删除；它们的**语义**搬到边界上——sash 拖动 = `resizeView`；折叠 = `setViewVisible(leaf, false, DistributeSizing)`；"链式折叠" = 同一手势里连续 `setViewVisible`。

### 分步

1. **栈 → 叶子**：`stack` 模式改为 `column` branch；删三个函数；门与单测改读数（"条目"→"叶子"）。
2. **补语义**：`max`、`priority`、`Sizing`（先 `Distribute`）、中心 priority。
3. **手势对齐**：sash 的 snap / edge collapse（复用现有 snap 的阈值与滞回）、`setViewVisible` 的分配语义。
4. **（可选，另裁）借用上游 `Grid` 作引擎**：那时模型已同形，替换成本小；代价是把 DOM 与几何交给上游 widget，isolation / frame / 门要重挂。

## 验收

- **第 1 步**：`verify:stack` 的三件事不变（一条裸渲染、两条成栈并可折叠、折叠后展开回原高）；`verify:persistence` 的"屏幕 = 状态"成立（`rows == sizes`，且刷新后一致）；单测里"栈内分配"改为"树的尺寸分配"。
- **第 2 步**：同轴三块——拖一条边 ⇒ **三块按比例变**、任一块 **≥ `min` 且 ≤ `max`**、另一轴**纹丝不动**；中心 priority：窗口变小时**中心最后让位**。
- **第 3 步**：sash 拖到边缘 ⇒ 该块 `visible = false`、空间按 `DistributeSizing` 分出去；拖回 ⇒ 恢复原尺寸；全程别的块不乱动。
- **第 4 步**：同 1–3，但门要验证"隔离宿主挂在 grid 的 leaf 元素上"。

## Alternatives

- **只补语义（G1）**：保持 prac 的树与两个空间，移植 `max` / `priority` / `Sizing` / snap。改动小，但"两个权威"这条张力留着，屏幕与状态仍可能分家。
- **保留栈、只把分配器做得更保守**（"只在交互结束时写回"）：治不了根，且每次新增写入者都要记得维持一致。
- **直接借用 `Grid` 作引擎（G3）**：保真度最高，但把 DOM 与几何交给上游 widget；等本提议落地、模型同形后代价小得多，故列为第 4 步。

## Open questions

- 升级到 grid 后，**持久化键是否仍留在 `v1`**（现状：不换版次，旧数据由人清）。
- `flex` 退场后，现有默认树（常驻区的比例、底栏固定高）能否都用 `size` / `min` / `max` 表达。
- `visible` 与既有的"空区域不渲染"如何对齐。
- 第 4 步要不要做，以及那时 isolation 的宿主挂在哪一层。

## Related

- [2026-10-05-vscode-dsh-layout-boundary.md](../in-progress/2026-10-05-vscode-dsh-layout-boundary.md)：区域骨架、隔离与对等；本提议接手它里面"栈内高度有两个权威"那条张力。
- `packages/client/ui-layout/DESIGN.md`：这个包的当前设计（§3.2 就是被本提议取代的那一节）。
