# UI surface map（参考）

> 两个生态的 UI 贡献面 → prac 的对象，以及 UI 术语表。决策与理由见 [2026-10-20-ui-framework.md](../.agents/notes/in-progress/2026-10-20-ui-framework.md)；本文只做参考映射，不承担决策。

## 1. 对象

```text
Application（启动身份）
Window（app 打开的实例）
Widget board（布局面）
Widget（可组合内容）

Space
  split / grid / region
    surface: window group（stage）/ widget board（panel / dock）
```

- window 由 application 打开，没有无主 window；
- window 两种：application window（editor / chat / terminal）与 widget window（承载 board）；
- window group 的 tab 是 window，不是 widget；
- widget 在 board 里，不直接进 window group；
- board 可以没有 window（panel / dock）；window 可以没有 board（application window）。

## 2. VS Code

| 贡献面                                                                  | 上游形态                                | prac                                                              |
| ----------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| 文件 / diff / custom editor / webview editor                            | editor input                            | **application window**                                            |
| `viewsContainers`                                                       | `ViewContainer` + `IViewContainerModel` | **widget board**（panel / dock），或 stage 的 **widget window**   |
| `views`（tree / webview view）                                          | `ViewPane` / `WebviewViewPane`          | **widget**，`hostKind = view-pane`                                |
| `viewsWelcome`                                                          | 空状态内容                              | widget 级空态，留在 widget host                                   |
| `view/title` / `view/item/context` / `editor/title` / `menus`           | 菜单项引用命令                          | **action model**；window tab strip / widget header / frame chrome |
| `commands` / `keybindings`                                              | 命令与键位注册表                        | command / keybinding，不是 widget                                 |
| webview panel / `customEditors`                                         | editor part                             | **application window**，`EditorPane`                              |
| 通知 / Quick Pick / Dialog / Context View / Hover                       | workbench 浮层服务                      | **frame overlay**（source-managed）                               |
| completion / 编辑器内 hover / decorations / CodeLens / inlay / comments | widget 自己的 DOM                       | **widget-local**；被盒子裁剪是正确行为                            |
| settings / keybindings UI / extension details                           | `EditorPane`                            | **application window**（editor placement）                        |
| activity bar                                                            | 选 container 的部件                     | frame chrome / dock；不是 widget                                  |
| themes / icons                                                          | 主题服务                                | frame / widget token；见隔离 note                                 |

**判据**：VS Code 的 UI 至少有 **part / container / view / editor / action / overlay / status item / host-local** 八类。prac 只把 editor input、container、view 映射成组合对象；part / overlay / action / status item 各自归格，不塞进 widget。

## 3. DSH

| 贡献面                                                             | 上游形态               | prac                                              |
| ------------------------------------------------------------------ | ---------------------- | ------------------------------------------------- |
| `main` keyed entry（conversation / plugin manager / task manager） | keyed slot             | **application window**                            |
| `sidebar` / `rightbar`                                             | 单 / keyed 槽          | **widget board**（panel / dock）                  |
| 内部 slot（conversation.* / sidebar.* / settings.* / plugins.*）   | slot entry / React     | **widget / section**，属于对应 app window / board |
| `shell.overlay` / toast / quota notice                             | 应用级浮层             | **frame overlay**                                 |
| `shell.leading` / `shell.bottom`                                   | 窗口 chrome 座位       | frame chrome / part seat                          |
| `prac.view` / `prac.viewActions`                                   | 自定义 widget / action | **widget / action slot**                          |
| `ctx.layout`                                                       | DSH layout compat      | `ctx.layout` compat，放 `ui-frame`                |
| client graph / loader / HMR                                        | 代码到达与替换         | lifecycle；frame 只订阅注册                       |
| store / locale / theme / 组件库                                    | 来源运行时             | source runtime；不进入 frame 模型                 |

**判据**：DSH 的槽不是来源，而是 host 词表。`sidebar` / `rightbar` 由 frame 渲染成 board；`main` 是 application window；内部 slot 是 widget；`shell.overlay` 是 frame overlay。

## 4. 摆放

- **placement 有两条边**：
  - `window → window group`；
  - `widget → widget board`。
- **active 有两级**：
  - window group 的 active window；
  - board 的 active widget。
- **surface**：
  - stage cell → window group；
  - panel / dock → widget board；
  - widget window 是 window，内容是 board，不是 region。
- **chrome**：
  - window group tab strip / actions → frame + window；
  - widget header / actions → board / widget；
  - breadcrumbs → editor application window；
  - overlay → frame float layer / widget-local。

## 5. 术语

| canonical              | 不要用                         | 说明                                                              |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------- |
| **application**        | container / app instance       | 启动身份；window 由 app 打开                                      |
| **window**             | tab / view                     | app 的实例；application window 或 widget window                   |
| **window group**       | editor group / view group      | windows 的容器；editor group 是 adapter runtime                   |
| **widget board**       | container / view group / panel | 摆放 widget 的布局面                                              |
| **widget**             | view / tab                     | 可组合内容；在 board 里                                           |
| **placement**          | membership                     | window → group；widget → board                                    |
| **surface**            | region content                 | region 的内容根；window group / board / opaque                    |
| **application window** | editor view / editor group     | editor / chat / diff / terminal 的 window                         |
| **widget window**      | container window               | 承载 board 的 window                                              |
| **editor group**       | prac window group              | `IEditorGroupView`，adapter runtime                               |
| **editor window**      | separate window type           | editor application window 的简称                                  |
| **catalogue**          | registry                       | 合并后的 widget / window 目录                                     |
| **source adapter**     | —                              | 把一个生态投影成 application / window / widget / action / overlay |

## 6. 包

| 包                 | 职责                                              |
| ------------------ | ------------------------------------------------- |
| `ui-frame`         | Space / split / grid / region / dock / panel      |
| `ui-window`        | window / window group / tab strip / active        |
| `ui-widget`        | widget / board / `prac.view` / `prac.viewActions` |
| `ui-workbench`     | 默认放置 / arrangement / recall                   |
| `ui-dsh`           | DSH slot → application / window / widget / action |
| `ui-vscode-host`   | VS Code bridge / face / catalogue                 |
| `ui-vscode-views`  | ViewContainer → board；ViewPane → widget          |
| `ui-vscode-editor` | editor input → application window                 |
| `bundle/web-app`   | composition root only                             |

完整依赖与迁移见 10-20 的 Package architecture。
