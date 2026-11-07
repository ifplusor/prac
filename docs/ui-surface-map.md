# UI surface map（参考）

> 两个生态的 UI 贡献面 → prac 对象。决策 / 理由在 `.agents/notes/proposed/`；本文只做现在时的映射参考。
> 词表见 [concepts.md](concepts.md)；架构见 [architecture.md](architecture.md)。

## 1. 对象

```text
PracAppDef / PracWidgetDef        // 声明
  → ApplicationDefinition / PracWidget  // runtime
    → PracWindow / WidgetPlacement      // window 与位置
      → WindowPlacement                // window 在 space root 的位置
```

- window 由 app 打开；没有无主 window；
- window group 的 tab 是 `PracWindow`；
- widget 在 board root；不直接进 window group；
- board 是内容；board window 才是 `PracWindow`；
- `PracCatalog` 是声明 / 定义的派生索引。

## 2. VS Code

| 贡献面 | 上游形态 | prac |
|---|---|---|
| 文件 / diff / custom editor / webview editor | editor input | `PracAppDef` + `PracWindow` |
| `viewsContainers` | `ViewContainer` | board / board window |
| `views`（tree / webview view） | `ViewPane` / `WebviewViewPane` | `PracWidgetDef` / `PracWidget` |
| `viewsWelcome` | 空状态 | widget 级空态 |
| `view/title` / `view/item/context` / `editor/title` / `menus` | 菜单项引用命令 | action model |
| `commands` / `keybindings` | 命令 / 键位 | command / keybinding |
| webview panel / `customEditors` | editor part | `PracWindow` + `EditorPane` |
| 通知 / Quick Pick / Dialog / Context View / Hover | workbench 浮层 | frame overlay |
| completion / hover / decorations / CodeLens / inlay / comments | widget DOM | widget-local |
| settings / keybindings UI / extension details | `EditorPane` | `PracWindow` |
| activity bar | 选 container 的部件 | frame chrome / dock rail |
| themes / icons | 主题服务 | frame / widget token |

**判据**：VS Code 的 UI 至少有 part / container / view / editor / action / overlay / status item / host-local 八类；prac 只把 editor input、container、view 映射成组合对象，其余各归各格。

## 3. DSH

| 贡献面 | 上游形态 | prac |
|---|---|---|
| `main` keyed entry（conversation / plugin manager / task manager） | keyed slot | `PracAppDef` + `PracWindow` |
| `sidebar` / `rightbar` | 单 / keyed 槽 | app / board（后续） |
| 内部 slot（conversation.* / sidebar.* / settings.* / plugins.*） | slot entry / React | `PracWidgetDef` / `PracWidget` |
| `shell.overlay` / toast / quota notice | 应用级浮层 | frame overlay |
| `shell.leading` / `shell.bottom` | 窗口 chrome 座位 | frame chrome / status |
| client graph / loader / HMR | 代码到达与替换 | lifecycle；frame 只订阅注册 |
| store / locale / theme | 来源运行时 | source runtime；不进入 frame 模型 |

**判据**：DSH plugin 是 Cordis plugin 包；prac 只消费 DSH plugin 级贡献，不读 Cordis 内部列表。

## 4. 摆放

- **placement**：
  - `PracWindow → window group`（`WindowPlacement`）；
  - `PracWidget → board root`（`WidgetPlacement`）。
- **active**：
  - window group 的 active window；
  - board 的 active widget。
- **surface**：
  - stage cell → window group；
  - sidebar / panel → board window；
  - board window 是 `PracWindow`，内容是 board。
- **chrome**：
  - window group tab strip / actions → frame + window；
  - widget header / actions → board / widget；
  - breadcrumbs → editor window；
  - overlay → frame float layer / widget-local。

## 5. 术语

| canonical | 不要用 | 说明 |
|---|---|---|
| **PracExtension** | partner | Cordis plugin + contribution |
| **PracCatalog** | catalogue | 派生索引 |
| **PracAppDef** | application record | app 声明 |
| **PracWidgetDef** | widget record | widget 声明 |
| **PracWindow** | WindowInstance / WindowRecord | window runtime |
| **PracWidget** | WidgetInstance / WidgetItem | widget runtime |
| **WindowPlacement** | WindowItem | window 位置 |
| **WidgetPlacement** | WidgetItem | widget 位置 |
| **window group** | editor group / view group | window 容器；editor group 是 adapter runtime |
| **board** | container / view group / panel | 内容面；board window 才是 window |
| **source adapter** | — | VS Code / DSH → prac 对象 |

## 6. 包

| 包 | 职责 |
|---|---|
| `prac-ui-kit-layout` | geometry / allocation / grid |
| `prac-ui-kit-content` | content root / item / placement / store / renderer |
| `prac-ui-kit-workbench` | app / window / group / board / widget / frame shell |
| `prac-client-ui-frame` | WM / frame / services / persistence / extension registry |
| `prac-client-ui-widget` | board / widget adapters |
| `prac-client-ui-workbench` | arrangement / default placement / recall / first-run |
| `prac-client-vscode-host` | VS Code bridge / face / catalog / commands |
| `prac-client-ui-vscode-views` | ViewContainer → board；View → widget |
| `prac-client-ui-vscode-editor` | editor input → window |
| `prac-client-dsh-host` | DSH slot / app / internal slot |
| `prac-web-app` | composition root only |

完整职责 / 目标新增见 [.agents/notes/proposed/2026-11-05-tech-packages.md](../.agents/notes/proposed/2026-11-05-tech-packages.md)。

## 7. 相关

- [concepts.md](concepts.md)
- [architecture.md](architecture.md)
- [window-model.md](window-model.md)
- [ui-acceptance.md](ui-acceptance.md)
