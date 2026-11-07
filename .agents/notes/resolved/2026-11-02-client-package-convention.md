---
status: resolved:implemented
---

# Agent Note: client 包入口规范

> 对象是 `packages/client/*`（DSH client 插件行）。规范的核心判断：**插件包不是库**——一个包只有一个加载面、一个 type-only 契约面，没有第二个可 import 的产物。稳定参考见 [docs/client-packages.md](../../../docs/client-packages.md)。

## Problem

8 个包，三处遗留。实测（2026-11-02）：

| 包 | loader entry | 额外产物 | `./client.types` | `check:client` |
| --- | --- | --- | --- | --- |
| `prac-client-ui-frame` | `src/client/plugin.ts` | 无 | `client-types.d.mts` ← `contract.ts` | 缺 |
| `prac-client-ui-workbench` | `src/client/plugin.ts` | 无（`index.ts` 是死 barrel） | 无 | 缺 |
| `prac-client-ui-dsh` | `src/client/plugin.ts` | `./lib` | 无 | 缺 |
| `prac-client-ui-widget` | `src/client/plugin.ts` | `./lib` | 无 | 缺 |
| `prac-client-ui-changed-files` | `src/client/plugin.ts` | `./lib`（零消费者） | 无 | 缺 |
| `prac-client-ui-vscode-editor` | `src/client/index.ts` | 无 | 无 | 有 |
| `prac-client-ui-vscode-views` | `src/client/index.ts` | 无 | 无 | 有 |
| `prac-client-vscode-host` | `src/client/index.ts` | 无（`public.ts` 出类型） | `client.d.mts` ← `public.ts` | 有 |

1. **`plugin.ts`**：5 个包把入口与体拆成两个文件。名字说的是"这个包是插件"——而整包都是插件，说的是身份，不是内容。
2. **`./lib`**：4 个包还在产第二个 artifact。全仓对它的 import 只有 4 行——3 个常量（`DSH_SIDEBAR_VIEW` 等）+ 2 个类型；没有任何运行时地方加载 `lib.js`。其中 `ui-changed-files` 的 `./lib` 零消费者。
3. **`index.ts` 名不副实**：3 个包里它是入口，3 个包里它只是库面，1 个包里它是死文件；`./client.types` 只有 2 个包有，产物名还不一致（`client-types.d.mts` / `client.d.mts`）；`check:client` 8 个包里只有 3 个有（`ui-vscode-editor` / `ui-vscode-views` / `vscode-host`），缺 5 个。

`./lib` 的来历：`583e7c8` 把 `ui-frame` 从库改成插件行时，包还带着 `./lib`（"library surface other plugins may import"）。插件化完成后这个角色没有随之删除，于是留下一条**build-time 值通道**。

## Motivation

插件包不是库，所以它不该有库的产物。跨包共享只有两条正规通道：

- **值 / 行为** → Cordis service（`ctx.pracDsh`、`ctx.pracWidgets`、`ctx.pracFrame`），消费者在 `inject` 里声明；
- **类型** → `./client` 的 `types` 条件（type-only，运行时不存在）。

`./lib` 是第三条通道：build-time 值 import。它绕过 service，也让同一个纯值在每个消费者的 bundle 里各留一份副本（模块记录）。今天乘客是常量所以没炸；换成任何带状态的单例就是分叉。DSH 对这条有明确禁令（feature plugin 不得 runtime-import 另一个 feature plugin 的值），prac 应该同样禁止——删掉 `./lib` 是让它变成**类型错误**而不是靠纪律。

`plugin.ts` 同理：入口和体分开之后，"哪个文件是入口"要靠配置才知道；入口即包，装配写在入口里，实现分到领域模块。

## 规范

### 1 包的两半

- **host**：`src/index.ts`，只 `export function apply(): void {}`。行在两个 plane 上都被 import，文件必须存在。
- **client**：`src/client/index.ts`（入口兼装配），加领域模块。

### 2 文件角色：一名一职

| 路径 | 角色 | 内容 | 产物 / 导出 |
| --- | --- | --- | --- |
| `src/client/index.ts` | 唯一入口，兼包的公开模块 | `name` / `inject` / `apply`（装配），以及该包愿意公开的值 | `dist/client.js` ← `clientPack`；`exports["./client"]` |
| `src/client/contract.ts` | type-only 契约（可选） | `Context` / `SlotMap` 合并、face 类型；**不得有 runtime import** | `dist/client-types.d.mts` ← `exports["./client"].types` |
| `src/client/<domain>.ts` | 实现 | store / service / chrome / adapter 等 | 无独立产物 |

- **没有 `plugin.ts`**：装配就是入口的职责。体大到装不下时，拆的是领域模块（`frame.ts` / `services.ts` / `store.ts`），不是给体换个名字。
- **没有 `./lib`**：不用 `lib.ts`，不做第二个构建，`exports` 里没有 `./lib` 键。
- **有角色才建文件**：没有跨包契约就不建 `contract.ts`、不写 `./client.types`。

### 3 跨包共享

- 值 / 行为：service。消费者 `inject` 声明，运行期从 `ctx` 取。
- 类型：`import type { … } from "prac-client-xxx/client"`。
- 同包测试：相对路径 import 内部模块（`../src/client/frame.ts`），不为了测试放宽公开面。
- 推论：**client 包之间只有 `import type` 这一种 import**。任何 value import 都是要删的通道。

### 4 artifact 守卫

每个 client 包都有 `check:client`（`scripts/bundle-client.mjs`）：loader 闭包存在、`--id` 等于包名、每个 `require` 都可答、没有 inline React、导出面是 `apply,name,inject`。

### 5 manifest

- `dsh.client.platform === "web"`；Cordis 在匹配的 `peerDependencies` 与 `devDependencies`。
- `exports`：`.`（host）、`./client`（`{ types?, default: "./dist/client.js" }`）、`./package.json`；声明 types 时产物名恒为 `dist/client-types.d.mts`。
- bundle row 的 `id` 等于包名，注册在 `packages/bundle/web-app/cordis.patch.yml`。

## Gate

新增 `tests/static/entries.mjs`（或在 package graph gate 里加一节），断言：

1. 每个 `packages/client/*` 有 `src/client/index.ts`，且没有 `src/client/plugin.ts` / `lib.ts`；
2. `vite.config.ts` 中每个 `clientPack()` 的 `entry` 是 `src/client/index.ts`、id 等于包名；
3. `exports` 不含 `./lib`，且没有 lib pack entry；
4. **包之间没有 value import**（只允许 `import type`）——这条替代对 `./lib` 的禁令，也是规范真正的牙齿；
5. 声明 `./client.types` ⇒ `src/client/contract.ts` 存在，types 指向 `dist/client-types.d.mts`；
6. 每个包有 `check:client` task。

## 迁移

1. **`plugin.ts` 消失**：`ui-frame` / `ui-workbench` / `ui-dsh` / `ui-widget` / `ui-changed-files` 把体并入 `index.ts`（后三个的体只有一行 re-export，`ui-workbench` 的现有 `index.ts` 直接转正），删 `plugin.ts`。
2. **`./lib` 消失**：
   - `ui-dsh` / `ui-widget` 新增 `contract.ts`，承载 `PracDshFace` / `PracWidgetsFace` 与各自的 `Context` 合并，走 `./client.types`；
   - `ui-changed-files` 直接删 `./lib`（零消费者）；
   - `ui-workbench` 的两处 type import 改指 `prac-client-ui-xxx/client`；
   - `ui-workbench` 的三处常量 import 改为从 `ctx.pracDsh` 取：`DEFAULT_PLACEMENTS` / `ROLES` 由模块级常量改为按 face 求值的函数（`arrange(layout)` → `arrange(layout, dsh)`），`arrangement.spec.ts` 跟着改。
3. **类型入口统一**：`vscode-host` 的 `public.ts` → `contract.ts`，产物 `client-types.d.mts`。
4. **补 `check:client`**：`ui-frame` / `ui-dsh` / `ui-widget` / `ui-workbench` / `ui-changed-files`。
5. 构建配置删掉 lib entry；`ui-widget` / `ui-changed-files` 的 lib `neverBundle` 一并消失。

## Drawbacks

- 大包的 `index.ts` 变长（`ui-frame` ~380 行、`ui-workbench` ~600 行）。DSH 的 `ui-conversation` 把装配放 `apply.ts`；prac 选"装配在入口、实现进领域模块"，代价是入口文件比通常的 index 重。
- 常量走 service ⇒ 依赖激活顺序（`ui-workbench` 现在 `inject` 里已经有 `pracDsh`，所以不是新增边），但纯值也经 `ctx` 这件事本身多了一层。
- 失去 `./lib` 后，"只有一个类型被别的包需要"也要建 `contract.ts`；对 `ui-widget` 这种只有 `PracWidgetsFace` 的包，样板略重。

## Open questions

1. 装配长到什么程度才该拆？拆的方向是领域模块，不换名字——但这需要一条能说清的门槛，否则又会漂。
2. `contract.ts` 是只承载 DSH 契约合并，还是也承载 prac 包之间的公共类型（`PracWidgetsFace` 属于后者）。
3. `./client.types` 用 `client-types.d.mts` 这一命名，还是跟 DSH 一样有独立 `./types` 键。目前选前者：少一个键。
4. Gate 第 2 条要读 `vite.config.ts` 文本；更稳的做法是让 `clientPack` 自己拒绝非 `src/client/index.ts` 的 entry（构建期就红），但那就把规范焊进 `scripts/pack-client.ts`。

## Validation

- gate 全绿；`pnpm build` / `pnpm test` / `pnpm verify:ui` 通过。
- 消费面：`ui-workbench` 的 arrangement 从 `ctx.pracDsh` 取到与常量相同的值（测试断言 `dsh:sidebar` / `dsh:rightbar` / `dsh:main:conversation`）；`ctx.pracWidgets` / `PracWidgetsFace` 的类型合并仍让消费方编译通过。
- 反例检验：在某个包加一行 `import { X } from "prac-client-ui-other"`，gate 必须变红；恢复 `./lib` 导出，gate 必须变红。
- 规范可用性检验：按 `docs/` 新建一个最小 client 包，只读文档一次通过 gate。

## Related

- [docs/file-naming.md](../../../docs/file-naming.md)：文件名约定（本文管**角色**，它管**大小写**）。
- [2026-10-20-ui-framework.md](../abandoned/2026-10-20-ui-framework.md)：「包入口按层」那条决定（`prac-ui-kit-*` 只出 `.`，`prac-client-*` 出 `./client`），本文是它在 client 包内部的下沉。
- [2026-10-23-ui-scheme.md](../abandoned/2026-10-23-ui-scheme.md)：插件化收口的经过（谁被拆成 row，`./lib` 从哪里来）。
- [docs/client-packages.md](../../../docs/client-packages.md)：本规范落成后的稳定参考（现时态、给消费者看）。
- [tests/static/entries.mjs](../../../tests/static/entries.mjs)：机械守卫。
- DSH checkout：`packages/client/tsdown.client.ts:124`（入口路径硬编码）、`packages/client/AGENTS.md:36-44`（`/client` 是公开 API；feature plugin 不得 runtime-import 别的插件值）。
