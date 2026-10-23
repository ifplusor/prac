---
status: in-progress
---

# Agent Note: stage 的分栏与调整尺寸对齐 VS Code Grid

## Problem

**stage 的分栏在"调整尺寸"这件事上能力不足**，没有 VS Code editor part 那种灵活性。VS Code 把这一切长在 `Grid` 的叶子上，prac 的区域只有 `size` / `flex` / `min`：

| VS Code editor part / Grid 有 | prac 的区域现在 |
| --- | --- |
| 每块 `minimumWidth/Height` **与 `maximumWidth/Height`**（`editorPart.ts:64-67`）| 只有 `min`，**没有 `max`** |
| `priority`（中心那一格是 `LayoutPriority.High`，`editorPart.ts:1046`）⇒ 空间紧张时**中心最后让位** | 没有优先级概念 |
| `Sizing`：`resizeView(...)`，以及 `setViewVisible(view, visible, DistributeSizing)`（`grid.ts:543/654`）⇒ "**同轴重新分配**"而不是只推邻居 | 拖 sash **只推动紧邻那一块** |
| grid 的 **edge snapping**（`grid.ts:283`）⇒ 拖到边缘吸附 / 收起 | sash 没有 snap |
| `leaf.maximized`（`ISerializedLeafNode`，`grid.ts:756-761`）⇒ 一块最大化 | 没有 |
| 它会知道"某块正卡在最小值上"（`editorPart.ts:783`）⇒ 才有收起 / 恢复的反馈 | 没有 |

**这条与"栈内高度的两个权威"无关**：那是布局模型的一致性问题（另见 [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md) 的开放问题），两者只在"借用 VS Code 形状"这一点上偶然同向，不是彼此的解法。

## Current implementation (for review)

The stage is now a **`GridNode`** with explicit `GridPlacement` cells, not the
single split tree this proposal started from:

- default stage shape is **2×2**; one present cell renders transparently, so the
  initial geometry is unchanged;
- `splitView`/`createRegionBeside` place new cells **by source side**, expanding
  rows/columns rather than appending row-major;
- cells can be **moved** (swap placement), **resized** (span, overlap refused),
  **merged** into a split cell, and **unmerged**; merge keeps the original
  `GridPlacement`s so unmerge restores unequal spans;
- `columnWeights` / `rowWeights` give free track resize; a drag on the track
  boundary changes the relative weights, and the weights persist;
- merge/unmerge placement data is persisted in the layout state.

The proposal's `max` / `priority` / `Sizing` / edge snap / `maximized` items are
still only partially represented: region-level `priority`, `max`, distribution
and snap exist in the split resize path, but grid tracks have relative weights
without pixel min/max, and there is no maximized cell or keyboard track resize.

This section records what the implementation now answers; it does **not**
promote the note. The status remains `proposed` until the decisions are signed.

## Proposal

给区域补上 VS Code Grid 的那几件能力，分层做：

1. **`max`**：区域除 `min` 之外声明 `max`；分配、拖 sash、窗口变化都按 `min ≤ size ≤ max` 收敛。
2. **`priority`**：区域可以声明优先级；中心默认 `High` ⇒ 空间紧张时**中心最后让位**（谁先让位、谁最后让位，成为设计的一部分，而不是实现里的偶然）。
3. **`Sizing`**：sash 拖动支持两种语义——`Distribute`（**同轴重新分配**：同轴所有块按比例吸收）与 `Expand`（只推邻居）。默认取 `Distribute`（对齐 `editorPart.ts:672`）。
4. **sash 的 edge snap**：拖到边缘吸附并收起该块（`visible = false`），空间按 `Distribute` 分出去；拖回恢复原尺寸。
5. **`maximized`**（可选）：一块临时最大化，不写进持久化。

**不动的东西**：栈（`stack` 模式与栈内高度）这次不改——它是布局模型自己的问题，见上面的"无关"说明；`flex` 先保留，等第 1–2 步落地后再评估是否退场。

## 验收

- **第 1 步**：`verify:stack` 的三件事不变（一条裸渲染、两条成栈并可折叠、折叠后展开回原高）；`verify:persistence` 的"屏幕 = 状态"成立（`rows == sizes`，且刷新后一致）；单测里"栈内分配"改为"树的尺寸分配"。
- **第 2 步**：同轴三块——拖一条边 ⇒ **三块按比例变**、任一块 **≥ `min` 且 ≤ `max`**、另一轴**纹丝不动**；中心 priority：窗口变小时**中心最后让位**。
- **第 3 步**：sash 拖到边缘 ⇒ 该块 `visible = false`、空间按 `DistributeSizing` 分出去；拖回 ⇒ 恢复原尺寸；全程别的块不乱动。
- **第 4 步**：同 1–3，但门要验证"隔离宿主挂在 grid 的 leaf 元素上"。

## Alternatives

- **只补语义（G1）**：保持 prac 的树与两个空间，移植 `max` / `priority` / `Sizing` / snap。改动小，但"两个权威"这条张力留着，屏幕与状态仍可能分家。
- **保留栈、只把分配器做得更保守**（"只在交互结束时写回"）：治不了根，且每次新增写入者都要记得维持一致。
- **直接借用 `Grid` 作引擎（G3）**：保真度最高，但把 DOM 与几何交给 VS Code widget；等本提议落地、模型同形后代价小得多，故列为第 4 步。

## Open questions

- 升级到 grid 后，**持久化键是否仍留在 `v1`**（现状：不换版次，旧数据由人清；grid placements/weights 已在同一 key 下持久化）。
- `flex` 退场后，现有默认树（常驻区的比例、底栏固定高）能否都用 `size` / `min` / `max` 表达。
- `visible` 与既有的"空区域不渲染"如何对齐。
- 第 4 步要不要做，以及那时 isolation 的宿主挂在哪一层。

## Related

- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：区域骨架、隔离与对等；本提议接手它里面"栈内高度有两个权威"那条张力。
- `packages/client/ui-layout/DESIGN.md`：这个包的当前设计（§3.2 就是被本提议取代的那一节）。
