---
status: abandoned:superseded
---

# Agent Note: UI surface 与隔离 — window 外层、widget 内部

> 组合模型：[2026-10-20-ui-framework.md](2026-10-20-ui-framework.md)。frame / grid：[2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)。VS Code adaptor：[2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)。

## Summary

- **window 是外层隔离边界**：containment / stacking / theme / focus / overlay anchor；
- **window 内部的 widget / view 默认保留自己的 root**，尤其是 VS Code + DSH 混排；
- 同源 window / board 可以合并 root，但必须先把 frame 的 `:host` / `:host-context` 规则迁到 widget wrapper；
- webview / iframe / opaque widget 使用自己的 browsing context；
- 跨 window 的 overlay 走 frame float layer；widget 自己 DOM 内的 overlay 留在 widget 内。

## Problem

prac 同时把 VS Code 和 DSH 的 UI 放进同一个桌面：

- VS Code 的 CSS 依赖 `.monaco-workbench` 语境、`.monaco-*` 类、主题变量、per-view containment；
- DSH 的 CSS 依赖自己的 root / CSS modules / theme token；
- frame 自己的 pane header chrome 用 `:host` / `:host-context`，前提是每个 view 是一个 shadow host；
- 两边的 overlay 模型不同：workbench 应用级 overlay（菜单、命令面板、通知、hover）与 widget 内部 overlay（补全、webview overlay）。

如果把这些内容直接放进一个共享 root：

- 两边的 global / reset / `@property` / `@keyframes` / token 会互相穿透；
- frame 的 `:host` 规则会指向 window 而不是 widget；
- per-view `contain: paint` 消失，VS Code overlay 可能盖到 DSH widget；
- focus / `activeElement` 边界变化，容易出现“焦点被读成 active”的回环。

## 1. Surface

`prac-ui-kit-workbench` 定义 host / surface 契约：

```text
window
  └─ surface root（window 外层）
       ├─ widget root（VS Code / DSH / core）
       ├─ widget root
       └─ opaque host（webview / iframe）
```

- **window**：placement / active / lifecycle 的边界；
- **surface root**：window 的内容根；负责 containment、stacking、theme、focus 的入口；
- **widget root**：单个 widget 的 CSS / DOM / overlay 边界；
- **opaque host**：外部内容，自己负责隔离。

surface 不定义 widget / window 的语义；它只定义“内容挂在哪、边界在哪、overlay 去哪”。

## 2. 隔离策略

### 默认

- **window 外层隔离**：window 有自己的 root / containment；inactive window 的内容根可以移除；
- **widget 默认有自己的 root**：尤其 VS Code / DSH 混排；
- **同源 window / board** 可以共享 root：需要先完成 frame `:host` 规则迁移，并验证 overlay / focus / theme。

### 强制独立 root

- webview / iframe：自己的 browsing context；
- opaque widget：来源自己管理内部 DOM / CSS；
- 混排 window：至少不同 source 的 widget 不共享 CSS 作用域。

## 3. CSS / theme 投放

- document 的样式表不会自动作用于 shadow tree；每个 root 需要实时镜像；
- 镜像不是死拷贝：主题表会被原地改写，需要订阅源表变化；
- 主题变量以 `:host` 作用域投放；**不要把 `.monaco-workbench` 放在 host 本身**，那会让规则作用到宿主与其祖先；
- VS Code widget 的**内部宿主元素**要带 `.monaco-workbench`，否则挂在它下面的 view 规则一条也匹配不上；
- DSH widget 使用自己的 root / CSS modules；
- root 的 `:host` 根样式负责尺寸、`display:flex`、`min-width/height:0`、`overflow`、`contain:paint`；
- 需要跨 root 的 frame chrome 规则（pane header 隐藏、hover actions）要迁到 widget wrapper 的 class / data 选择器，不能再依赖 `:host-context` 跨 window。

## 4. Overlay

- **workbench 应用级 overlay**（菜单、命令面板、通知、hover、模态）→ frame float layer；
- **widget 内部 overlay**（补全、peek、webview overlay）→ widget 自己的 root；
- frame 的 float layer 是全局坐标系；widget 内部 overlay 不能假设能跨出 window；
- window 的 `contain:paint` 会裁剪越界内容；需要越界的 overlay 必须走 float layer；
- overlay 的 focus / dismiss / stacking 由创建方负责，frame 只提供 layer / order。

## 5. Focus / a11y

- window 是 focus 的顶层边界；frame 拥有 active window；
- widget root 内部保留浏览器焦点链；
- 跨 shadow 的 `activeElement` 是两层链（host + `shadowRoot.activeElement`）；
- 不用 `focusin` 从旧宿主推断“人在这块区域工作”；active 变化走显式事件；
- a11y 树穿透 shadow root；首次 Tab 应进入 widget root。

## 6. 生命周期

- inactive window / board：移除内容根；状态由 window / widget model / source 保存；
- 重新激活：重新挂载 root，恢复 layout / focus / scroll；
- webview / iframe 移动会换 browsing context，默认 reload；需要保留状态时用 source 的 view state，不承诺 DOM 迁移；
- theme / locale 变化：root 的镜像表原地更新，不重建 root。

## 7. Decisions

- window 是外层 containment / stacking / theme / focus 边界。
- widget 默认保留自己的 root；混排 window 强制 per-widget root / source-scoped 子树。
- webview / iframe / opaque widget 自己隔离。
- VS Code 的 `.monaco-workbench` 在 widget 内部宿主，不在 host 本身。
- frame `:host` / `:host-context` 规则不能跨 window 共享 root；迁移到 widget wrapper 后才考虑合并。
- 应用级 overlay 走 frame float layer；widget 内部 overlay 留在 widget。
- inactive window / board 移除内容根，状态由 model / source 保留。

## 8. Open questions

- 同源 window / board 合并 root 的具体收益与迁移成本；
- 混合 root 下 `:host` 规则迁移到 class / data 选择器的完整清单；
- window 级 CSS 镜像的更新时机与性能；
- 多层 shadow 嵌套（window root + widget root + webview）的 overlay / focus 规则；
- widget 跨 window 移动时 DOM 迁移 vs 重建的边界。

## 9. Validation

- 混排 window 中，VS Code widget 与 DSH widget 的 CSS / theme / reset 不互相影响；
- frame pane header 的隐藏 / hover actions 在 per-widget root 下仍成立；
- workbench 菜单 / 命令面板 / hover 不被 window 裁剪；
- widget 内部补全 / webview overlay 留在 widget 内；
- inactive window 移除 root 后，重新激活能恢复 layout / focus / scroll；
- webview 在 plain HTTP / 非 secure context 下明确报错，不静默空白；
- a11y：a11y 树可见、Tab 能进入 widget root。
