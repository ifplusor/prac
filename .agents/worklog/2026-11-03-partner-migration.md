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

## 3. 尝试 2：先补「管理器变更通知」再删座位（round 6，仍失败）

假设：`pracFrame.listItems()` 只在 layout store / slot 变更时被重读，app 窗口的 admit 不触发任何通知，于是 `vscode-host` 的 `syncFrameEditorOrder`（它遍历 `listItems()` 找 `vscode:file:`）读不到 file window。

做法：`WindowManager.onDidChange` + 在 `ui-frame` 里把它接到 `bumpCatalogue`；然后重做 step ②。

结果：**同一组 8 项失败，一项不差**。所以通知不是根因（或不是唯一根因）。连 `chatActiveProjects` / `chatOrderProjects` 这种与 file window 无关的投影断言也一起红，说明失败面比「listItems 缺 file」更宽——更像是 `ui-workbench` / `vscode-host` 的整条投影 effect 没跑或提前失败，而不是逐项数据缺失。

下一步（round 7 起）不再猜：起一个不被 `verify-ui` 回收的 rig，打开一个文件，直接读页面 console 与 `__pracFrame.listItems()` / `mappedWindows()`，把「投影 effect 是否跑、跑了几次、读了什么」变成观测值，再改。

代码已回退；`WindowManager.onDidChange` 保留（无订阅者，行为不变）。

## 4. 尝试 3：座位由管理器写 + close 修好（round 7，成功）

做法改变：不再删座位，而是**由窗口管理器写座位**——`admit` 时用 app 的 `content(windowId)` 与 `paneHeader` / label 注册一条 `prac.window`，`close` 时回收；editor 只注册 app + admit/close。

排查过程：

1. 第一次重跑：8 项失败里只剩 `twoPlacementsAreTwoViews`，其余全绿（内部座位让目录/投影恢复）。
2. 用探针读 `__pracFrame.listItems()`：split 后同一 resource 有 **三条** file view（`p0` / `p1` / `p4`），app 只有 `p1` / `p4` 两个 placement ⇒ `p0` 是陈旧项。
3. 根因：`WindowManager.close()` 在 group-less 分支里 **先 return**，只 dispose 了座位，没有删 `#appOf` / `#titles` / `#handles`，于是 `windows.ids()` 仍列出 `p0`，`listItems()` 继续返回它。
4. 修法：`close` 先清记录（座位、appOf、titles、handles），再按是否有 group 决定是否 `runtime.remove`，两种情况都 `notify`。

验证：`build` / `test` / `verify:entries` 绿；**`verify:ui` 全绿**（`UI ACCEPTANCE: all gates passed`）。

## 5. 测试体系（round 8）

删除 `prac.window` 卡住两次之后，把「测试是基线，不是真理」这件事做成机制：

- `docs/testing.md`：四层（L0 静态 / L1 单测 / L2 模型集成（缺）/ L3 live），以及**behaviour vs probe** 的判定与改 gate 的流程；
- `tests/gates/classify.mjs` + harness：gate 用 `probes: [...]` 声明读内部的检查；失败时分开打印，probe 失败提示「若模型变化是有意的，改 gate 并记录」；
- `vendor/vscode/scripts/verify-file.mjs` 声明了 15 个投影/内部检查为 probe（`twoPlacementsAreTwoViews` 就在其中——它正是上次卡住的那条）；
- 补了一条 L1 回归：「group-less window 关闭后不得留在目录里」（stale `p0`）。

已知缺口：L2（模型级集成，不启浏览器）还没有，所以跨对象路径仍只能靠 4 分钟的 live gate 发现——下一步补。
