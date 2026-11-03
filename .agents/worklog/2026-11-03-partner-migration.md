# Worklog: partner 机制迁移（过程/证据）

> 过程/证据，不签字；设计见 [.agents/notes/proposed/2026-11-03-partner-mechanism.md](../notes/proposed/2026-11-03-partner-mechanism.md)。

## 1. 窗口管理器（round 1–2）

- `WindowManager` 建在 `ui-frame`，`WindowGroupBindings` 继续做 region 投影，管理器只做成员归属 + active；三套 group 实现里两套说 `add/remove/select`，kit 的 `WindowGroupModel` 是 `openWindow/closeWindow/activateWindow`，已补别名。
- `ctx.pracApplications` / `ctx.pracWindows` 上线；`admit(appId, …)` 是窗口进 group 的唯一入口，单实例复用、已持有只激活。
- 验证：kit 167、ui-frame 30+ tests；`pnpm build` / `verify:entries` / **`verify:ui` 全绿**。

## 2. 尝试 1：editor 变 app + 删除 `prac.window`（round 4，已回退）

做法：editor 注册 `editor` app（`content = host.hostFor`），用 `pracWindows.admit("editor", { windowId, title })` 替代每文件 `slots.register("prac.window", …)`；ui-frame 删掉 `prac.window` 座位（`SlotMap`、`root` 声明、catalogue 读取、`layout-item` 派发、`PracSlotKey`）。

结果：`pnpm build` / `test` / `verify:entries` 绿，但 **`verify:ui` 红**，`verify-file` 里 8 项失败：

```
secondRegionIsASecondGroup, chatActiveProjects, fileActiveProjects,
chatOrderProjects, chatMovesRegion, fileOrderProjects,
previewSurvivesCloseReopen, twoPlacementsAreTwoViews
```

观察与推断（未逐项定位）：

- file window 原本没有 group：它由 arrangement 直接放到 region，`prac.window` 那条注册同时是 **frame 的视图目录项**（id / label / paneHeader）与**内容**。删掉座位后，窗口的 chrome 事实只剩「app 元数据 + manager 标题」这条新路径，而 `verify-file` 的投影 / group / tab 断言显然还依赖旧路径带出的东西。
- 失败集中在「第二个 editor group」「active 投影」「order 投影」——这些恰好是 `ui-vscode-editor` 的 chrome 同步（`layout.setItemFlags` / `mapWindow` / `syncFrameEditorOrder`）与 slot 注册同源的区域。
- 回退后同一套 gate 恢复全绿，证明失败来自这次迁移而不是环境。

结论：**先补齐「窗口 chrome 事实」的模型来源，再删座位**。file window 的 label / paneHeader / closable / active 投影要有一条不依赖 slot 注册的路径（app 元数据 + manager 标题已有，但 `closable` / 投影的输入还没接上）；同时 `verify-file` 的每个失败断言要能被单独读完再改。

代码已回退到 `9e3773f` 的状态（manager 的 `handle` / group-less admit / app 元数据保留）。
