---
status: in-progress
---

# Agent Note: prac 与 VS Code 的概念边界与命名

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。VS Code adaptor：[2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)。

## Summary

prac 同时使用 DSH、VS Code 和自己的工作台词汇。边界原则只有一条：

> **来源词只出现在边界里；prac 自己的对象用 prac 词。机制不认识来源。**

- `vscode` / `dsh` 是来源标签，不是 prac 的 UI 类型；
- `application` / `window` / `widget board` / `widget` 是 prac 的组合词；
- `IEditorGroupView` / `EditorPane` / `ViewPane` 是上游接口，只出现在 adapter / host 内部；
- frame / `ui-frame` / `ui-window` / `ui-widget` 的 API 不出现 `vscode:` / `dsh:` 分支。

## 1. 词汇

| 层 | prac 词 | 来源词（只到边界） |
|---|---|---|
| 组合 | application、window、widget board、widget | — |
| 容器 | window group、region、surface、panel、dock | `ViewContainer` / `ViewPaneContainer` |
| 内容 | widget、application window、editor application window | `ViewPane` / `EditorPane` / `EditorInput` |
| 运行时 | editor group（adapter runtime） | `IEditorGroupView` / `EditorGroupModel` / `EditorPanes` |
| 来源 | `vscode` / `dsh` / `core` | `vscode:` / `dsh:` id 前缀 |
| 命令 | action model | `MenuId` / command / menu |
| 浮层 | frame overlay / widget overlay | workbench context view / notification |

## 2. 决定

1. **包名允许来源词**：`ui-vscode-host` / `ui-vscode-views` / `ui-vscode-editor` / `ui-dsh` 是边界包，包名出现来源是诚实的。
2. **跨平面契约用共享常量模块 + 构建期内联**，不引入运行期耦合。
3. **`part` 只做边界词**：对外 `partHost`，机制内部只用 region / surface / window / widget；`ui-frame` 内部没有 `part` 类型。
4. **机制不知道来源**：frame 判“是不是一个 widget”按注册表成员，不按 id 前缀。
5. **通道用 DSH service**：机制 → 编排用 `ctx.provide`；view / widget 声明注入服务。只有补丁侧必须留全局，换进 construction options。
6. **window 模型是 prac 词，editor group 是 adapter 词**：window group 是 prac 窗口容器；`IEditorGroupView` 是它在 adapter 的 runtime counterpart。window 由 app 打开；widget 是 board 的 placement；EditorWindow 是 VS Code editor application window 的 prac 实现，不再套 `VscodeWindow` / `VscodeHost`。
7. **`prac.view` 是 widget 注册面**，不承载 window / board；`application` / `window` / `board` 有各自注册面。

## 3. 出界检查

- 上游内部标识只出现在边界：`workbench.parts.*`、`monaco-workbench`、`vs` / `vs-dark`、`_VSCODE_FILE_ROOT`、`remoteAuthority` / `serverBasePath` / `callbackRoute` / `productConfiguration` / `workspaceProvider`、`workbench.web.main.internal.js`；
- 越界到 prac 的只能是 prac 词：`prac.view`、`prac.viewActions`、同源路由 path、带来源标签的 id；
- 机制 / frame 的源码不出现 `vscode:` / `dsh:` 分支；
- 一个越界契约只定义一次。

## 4. 开放问题

- `ui-vscode-*` / `ui-dsh` 包名是否在落地时保留来源词（当前是）。
- `ctx.pracLayout` 兼容别名何时删除。
- `prac.view` 是否改名为 widget 注册面（代码层）。
- 来源 id 前缀是否在 catalogue 外继续使用。

## 5. Validation

- `ui-frame` / `ui-window` / `ui-widget` 源码无 `vscode:` / `dsh:` 分支。
- frame 只按注册表成员识别 view / widget。
- `ui-vscode-*` / `ui-dsh` 的 API 不泄漏上游内部类型到核心包。
- `ui-frame` 的 `./lib` 不导出 `part` 类型。
- `prac.view` 只注册 widget；window / board 通过各自注册面。

## 6. Related

- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：组合模型 / package architecture。
- [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)：VS Code adaptor。
- [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)：总 umbrella。
