---
status: in-progress
---

# Agent Note: frame geometry — Space、grid、region 与 surface

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。隔离：[2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)。

## Summary

`ui-frame` 拥有 prac 的几何与 frame chrome：

- Space；
- split / grid / region；
- dock / panel；
- sash / track / resize / collapse；
- frame 的外层布局与区域角色。

它**不拥有** window / widget 的内容；region 的内容根是 **surface**：

| region | surface |
|---|---|
| stage 的 grid cell | **window group** |
| primarySidebar / secondarySidebar / panel | **widget board** |
| opaque host | 外部内容 |

几何契约（split / grid / region / sash / track / resize）不因为 window / widget 模型改变。

## Problem

prac 的 stage 需要 VS Code editor part / Grid 级别的分栏能力，但当前区域只有 `size` / `flex` / `min`，缺少：

- `max`；空间紧张时没有优先级；
- `Sizing`（同轴重新分配 vs 只推邻居）；
- edge snap（拖到边缘吸附 / 收起）；
- `maximized` 单元格；
- 拖到最小值时的收起 / 恢复反馈。

同时，region 的内容根以前统一是 view group；在 window / widget 模型下，stage region 是 window group，panel / dock region 是 widget board。

## 1. 几何模型

```text
Space
  split / grid / region
       └─ surface
            ├─ window group（stage cell）
            └─ widget board（panel / dock）
```

- **split**：一维分区，孩子是 layout node；
- **grid**：二维分区，行 / 列 / cell / span；stage 的内容是 grid；
- **region**：叶子盒子，只有一个 surface；
- **surface**：window group / widget board / opaque host；
- **placement**：window → window group；widget → widget board；
- **active**：window group 的 active window；board 的 active widget。

## 2. Grid

stage 是 `GridNode` + 显式 `GridPlacement`：

- 默认 2×2；一个 cell 时透明渲染，初始几何不变；
- `splitView` / `createRegionBeside` 按来源方向放新 cell，扩展行 / 列；
- cell 可以 move（swap placement）、resize（span，拒绝重叠）、merge / unmerge；merge 保留原始 placement，unmerge 恢复不等 span；
- `columnWeights` / `rowWeights` 负责自由 track resize；拖 track 边界改相对权重，权重持久化；
- merge / unmerge 的 placement 数据持久化。

## 3. 区域能力

| 能力 | 语义 |
|---|---|
| `min` / `max` | 分配、sash、窗口变化都收敛在区间内 |
| `priority` | 空间紧张时谁先让位；中心默认 High，最后让位 |
| `Sizing` | `Distribute`（同轴按比例吸收）或 `Expand`（只推邻居）；默认 Distribute |
| edge snap | 拖到边缘吸附并收起该 region；拖回恢复原尺寸 |
| `maximized` | 临时最大化一个 cell；不写进持久化 |
| `visible` | 收起 / 空区域不渲染；与 surface 生命周期解耦 |

## 4. Surface

- `ui-frame` 只认 surface registry，不 import `ui-window` / `ui-widget`；
- stage region 向 registry 要 window group surface；
- panel / dock region 向 registry 要 widget board surface；
- surface 负责自己的内容、lifecycle、isolation；
- frame 负责 region 的几何、collapse、resize、active surface；
- window group / board 的 active 是 surface 内部状态，不是 region 的字段。

## 5. Chrome

- frame chrome：title bar、dock、panel、Space switcher、window group tab strip 的外框；
- window group 的 tab strip 内容由 `ui-window` 提供；
- widget board 的 header / actions 由 `ui-widget` 提供；
- frame 不画 widget 内部 header，也不画 app window 的 breadcrumbs；
- actions 在 window group tab strip 右端，由 frame 渲染 adapter 的 action model。

## 6. 持久化

- `Space`、grid placement、track weights、region collapse / maximize、surface kind 属于 frame persistence；
- window group 的 window order / active 属于 window persistence；
- board 的 widget placement / active 属于 widget persistence；
- 迁移旧 `views` / `viewGroups` 数据时，按 surface kind 拆成 window / widget 两套记录。

## 7. Decisions

- 几何层 split / grid / region / sash / track / resize 保持不变。
- stage cell 的 surface 是 window group；panel / dock 的 surface 是 widget board。
- grid 支持 max / priority / Sizing / snap / maximized；默认 Sizing = Distribute。
- frame 只认 surface registry，不 import window / widget。
- window group / board 的 active 是 surface 内部状态。
- frame chrome 与 window / widget chrome 分层，不互相画。
- 包归属：`ui-frame`；迁移期由 `ui-layout` facade 转发。

## 8. Open questions

- 旧持久化 key 是否仍在 `v1`；旧数据是否自动迁移。
- `flex` 退场后，默认区域比例 / 固定高度是否都能用 size / min / max 表达。
- `visible` 与“空区域不渲染”的统一规则。
- 是否需要在 frame 层支持键盘 track resize。
- surface kind 是否允许运行时替换（window group ↔ board），还是只允许同 kind 重挂。

## 9. Validation

- 同轴三块：拖一条边 ⇒ 三块按比例变，任一块 ≥ min 且 ≤ max，另一轴不动。
- 中心 priority：窗口变小时中心最后让位。
- sash 拖到边缘 ⇒ 该 region 收起、空间按 Distribute 分出去；拖回恢复。
- stage cell 是 window group；panel / dock 是 widget board；tab 是 window，不是 widget。
- inactive window / board 移除内容根后，重新激活恢复 layout / focus / scroll。
- 刷新后屏幕与状态一致：rows / columns / weights / collapse / maximize 恢复。
- 包依赖 gate：`ui-frame` 不 import `ui-window` / `ui-widget` / `vscode` / `dsh`。

## 10. Related

- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：组合模型 / package architecture。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：surface / isolation。
- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：window group 的 editor runtime。
- [2026-10-17-stack-view-chrome.md](2026-10-17-stack-view-chrome.md)：stack / widget header 的标题归属。
