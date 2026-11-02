---
status: in-progress
---

# Agent Note: prac 的界面形态 —— VS Code × DSH 融合

## Summary

prac 的 UI 是 project folder 范围内的 **OS-like 工作台**：

- **Space** 是核心；默认一个，按需创建；
- application 打开 window，window 放进 window group；
- Explorer / SCM / GitLens 等是 widget board；Timeline / Outline 等是 widget；
- 两侧 dock、panel、中央 stage；
- frame 拥有组合与布局；VS Code / DSH 提供内容与运行时。

目标不是把任一生态的 UI 直接套壳，而是：

> **复用 VS Code 与 DSH 的 UI 实现和运行时，但不复用它们的 layout；组合、placement、surface 边界归 prac。**

## 1. 两个生态

| 来源 | 复用 | prac 自己拥有 |
|---|---|---|
| **VS Code** | 扩展宿主、editor / tree / webview / command / menu / overlay runtime | workbench 顶层 layout / part placement；prac 的 frame / window / widget |
| **DSH** | client 插件、slot、React、store、locale、theme | `ui-*` 的布局 / 组合 / placement / chrome |
| **prac** | — | Space、window group、window、widget board、widget、surface、actions / overlay 边界 |

## 2. 当前模型

完整模型见 [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。

```text
Application（启动身份）
Window（app 打开的实例）
Widget board（布局面）
Widget（可组合内容）

Space
  split / grid / region
    surface: window group / widget board
```

- window 由 app 打开，没有无主 window；
- window group 的 tab 是 window，不是 widget；
- widget 在 board 里，不直接进 window group；
- board 可以没有 window（panel / dock），window 可以没有 board（application window）；
- VS Code editor input → application window；ViewContainer → board；View → widget；
- DSH `main` → application window；sidebar / rightbar → board；内部 slot → widget；shell overlay → frame。

## 3. 包

完整划分见 10-20 的 Package architecture：

```text
prac-ui-kit-core
prac-ui-kit-workbench
ui-frame
ui-application
ui-window
ui-widget
ui-workbench
ui-dsh
ui-vscode-host / ui-vscode-views / ui-vscode-editor
bundle/web-app  // composition root only
```

- `ui-frame` 只认 surface registry；
- `ui-window` / `ui-widget` 不互相 import；
- adapters 只做来源翻译；
- bundle 是叶子，无业务逻辑。

## 4. 步骤 note

- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：组合模型 / package architecture / 术语。
- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：editor application window / pane host。
- [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)：VS Code adaptor。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：surface / isolation。
- [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)：frame geometry。
- [2026-10-17-stack-view-chrome.md](2026-10-17-stack-view-chrome.md)：stack / widget header。
- [2026-10-23-ui-scheme.md](2026-10-23-ui-scheme.md)：产品设计。
- [2026-10-27-ui-user-stories.md](2026-10-27-ui-user-stories.md)：用户故事 / 验收。
- [2026-09-19-architecture.md](2026-09-19-architecture.md)：需求 → 架构。

## 5. 约束

- 不 fork 上游；VS Code 只 pin + patch + overlay；DSH 走自己的组装层。
- frame 不认识 `vscode:` / `dsh:` 来源。
- adaptor 不拥有 frame / window / widget 的 layout / active / placement。
- window 只能由 app 打开；没有无主 window。
- widget 重组只发生在 board 之间；不走 app window。
- VS Code 的 part / editor group 不作为 prac 的顶层布局。
- bundle 只做 composition root，不做业务逻辑。
- webview / integrated browser 的可用性按 web / Electron 分别处理，不假装不存在。
- free-window 模式短期不做，tile mode 是当前唯一模式。

## 6. Open questions

1. stage widget window 的 host app（建议 `workbench.widgets`）。
2. application window 内是否允许 widget board slot（MVP 不允许）。
3. widget copy 语义；空 board / 空 window 的关闭策略。
4. actions 的 exact ownership / action model 字段 / overflow。
5. `EditorPaneHost` 从 `EditorPanes` 抽取还是过渡复用。
6. extension `tabGroups` API 的映射 / 隔离。
7. 包名 / surface 依赖 / `ui-application` 是否独立。
8. persistence schema 迁移与 service facade。
9. DSH 内部 slot 作为 widget 的可移动性边界。
10. 同源 window / board 合并 shadow root 的迁移条件。

## 7. Validation

- VS Code / DSH 的 UI 可以同屏、同 board、同 window group 组合，frame 没有来源分支。
- editor window / widget board / widget 的映射按 10-20 成立。
- window group 的 tab 是 window，widget 不成为 tab。
- 关最后一个 widget 不误关 window group / region。
- 混排 window 的 CSS / overlay / focus 不互相穿透。
- bundle 依赖 gate：不 import 业务逻辑，不被其它包 import。
- 活体门：editor / file / views / outline / focus / tabs / close / layout / view；加上 window group / widget / board 的新断言。

## 8. Related

- [2026-09-13-vs-concept-boundary.md](2026-09-13-vs-concept-boundary.md)：术语边界。
- [2026-09-19-architecture.md](2026-09-19-architecture.md)：需求 → 架构。
- [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)：UI 组合模型。
- [2026-10-23-ui-scheme.md](2026-10-23-ui-scheme.md)：产品设计。
- [docs/architecture.md](../../../docs/architecture.md)：目标架构。
