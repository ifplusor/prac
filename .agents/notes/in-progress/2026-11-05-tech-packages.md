---
status: in-progress
---

# Technical packages — mapping, dependencies, builds

> 技术设计附录；架构见 [tech-architecture](./2026-11-05-tech-architecture.md)。
> 本文只回答“哪个包承担哪些职责、依赖怎么走、怎么构建”；**不定义架构**，也不把当前包清单当边界。

## 1. 当前包

| 层 | 包 | 包职责 |
|---|---|---|
| L0 | `prac-ui-kit-layout` | geometry / tree / allocation / grid |
| L1 | `prac-ui-kit-content` | content root / item / placement / store / renderer |
| L2 | `prac-ui-kit-workbench` | app / window / group / board / widget 的**类型 / 契约** + frame shell 的渲染原语（region content / bindings / bridge 在 L2 refactor 中退役；模型权威见 [tech-ui](./2026-11-05-tech-ui.md)） |
| L3 | `prac-client-ui-frame` | WM / frame / services / persistence / extension registry |
| L3 | `prac-client-ui-widget` | board / widget adapters |
| L3 | `prac-client-ui-workbench` | arrangement / default placement / recall / first-run |
| L3 | `prac-client-ui-changed-files` | turn-tail card / diff entry |
| L3 | `prac-client-vscode-host` | VS Code bridge / catalog / commands |
| L3 | `prac-client-ui-vscode-views` | ViewContainer → board；View → widget |
| L3 | `prac-client-ui-vscode-editor` | editor input → window / pane host |
| L3 | `prac-client-dsh-host` | DSH slot / host / internal slot |
| Server | `prac-host-vscode` | code server / extension host / policy / webview endpoint |
| Bundle | `prac-web-app` | composition root |

## 2. 目标新增

| 包 | 职责 | 依赖 | 状态 |
|---|---|---|---|
| `prac-host-vscode-lsp` | DSH `ctx.lsp` provider adapter | `prac-host-vscode` + `prac-vscode-embed` + DSH `lsp` | 目标 |
| `prac-host-turn-diff` | changed-files 的 turn-scoped before / after reader | Host `workspaceChanges` + `subprocess` | 目标 |
| `prac-host-vscode-mcp` | MCP 定义来源 → DSH MCP client | `prac-host-vscode` + DSH MCP client | future；MVP 不做 |

> 这些是设计需要，不是当前仓库已有；包名可以再定，职责边界先定。
>
> L2 的分层、定位与重构见 [tech-ui-kit](./2026-11-12-tech-ui-kit.md)。

## 3. 依赖规则

- **单向**：kit → client → bundle；client 之间只有 `import type`。
- **kit 不 import client**；kit 不依赖 DSH。
- **server primitives 不依赖 DSH seam**：`prac-host-vscode` 不 import `@deepseek-ai/dsh-lsp`。
- **能力 adapter 依赖对应 seam**：`prac-host-vscode-lsp` 才 import `lsp`。
- **bundle 是叶子**：无业务逻辑，只做 composition root。
- **client / host 包是 Cordis plugin**：prac / DSH 共用 Cordis loader / Context；extension contribution 走 `ctx.pracExtensions`，不新增 loader。
- **client 包之间不 import 值**：走 Cordis service / `import type`。
- **新增包的最低要求**：owner、稳定 contract、依赖方向、测试 / gate。

## 4. 构建 / 入口

- client 包：`src/client/index.ts` → `dist/client.js` loader；可选 `src/client/contract.ts` → `dist/client-types.d.mts`。
- host 包：`src/index.ts` → `dist/index.mjs`。
- bundle：`cordis.patch.yml` 注册行；`prac-web-app` 只做组装。
- 静态 gate：`tests/static` 检查 entry / 依赖 / bundle leaf；新增包要加规则。

## 5. 可能再拆的包

- `prac-client-ui-workbench` 的 arrangement / chrome 变大 → 拆 `prac-client-ui-chrome`；
- IDE 的 terminal / SCM / search 如果需要独立 runtime → 按组件边界新增，不塞进 views / editor；
- extension mechanism 变大 → 独立 lib；
- quality / ops 横切，不强行一个包。

> 拆包不是目标；**职责边界清楚**才是。

## 6. Open

1. `prac-host-vscode-lsp` / `prac-host-turn-diff` 的包名与落点。
2. arrangement / chrome 是否拆包。
3. IDE runtime 是否需要新包。
4. MCP definition source 的包名（future）。
5. 静态 gate 怎么覆盖新增包。

## Related

- [tech architecture](./2026-11-05-tech-architecture.md)：组件 / 进程 / 状态 / 协议。
- [tech-quality](./2026-11-05-tech-quality.md)：测试 / 部署。
- [tech-extension](./2026-11-05-tech-extension.md)：extension / catalog / 包职责。
- [docs/client-packages.md](../../../docs/client-packages.md)：client 包规范。
