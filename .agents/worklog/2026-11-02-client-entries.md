# Worklog: client 包入口归一（implementation）

> 过程/证据，不签字；设计见 `.agents/notes/resolved/2026-11-02-client-package-convention.md`，稳定参考见 [docs/client-packages.md](../../docs/client-packages.md)。

## 1. 入口归一：`plugin.ts` → `index.ts`

五个包的 body 并进入口，`./lib` 从构建配置与 `exports` 里删除：

| 包 | 之前 | 之后 |
| --- | --- | --- |
| `ui-frame` | `clientPack(plugin.ts)` | `clientPack(index.ts)`；补 `check:client` |
| `ui-workbench` | `clientPack(plugin.ts)` + 死 barrel `index.ts` | barrel 删除，`plugin.ts` 改名 `index.ts` |
| `ui-dsh` | `clientPack(plugin.ts)` + `./lib` | `index.ts` 只 re-export `service.js`；新增 `contract.ts` |
| `ui-widget` | 同上 | 同上 |
| `ui-changed-files` | 同上（`./lib` 零消费者） | `./lib` 直接删除 |
| `vscode-host` | `public.ts` 出类型，产物 `client.d.mts` | `contract.ts`，产物 `client-types.d.mts` |

## 2. DSH 词汇改走服务（唯一有行为影响的一处）

`ui-workbench` 的 arrangement 原来在模块级 import `DSH_SIDEBAR_VIEW` 等三个常量；`./lib` 删除后改为从 `ctx.pracDsh` 取值：

- `DEFAULT_PLACEMENTS` / `ROLES` 两个模块级常量改成 `defaultPlacements(dsh)` / `roles(dsh)`；
- `arrange(layout)` / `placeCatalogue(layout, entries, …)` / `restoreCentre(layout)` 增加 `dsh: PracDshFace` 参数（`PracDshFace` 从 `prac-client-ui-dsh/client` type-only import）；
- `arrangement.spec.ts` 自带一份 `DSH` 面（测试允许重述字面量），20 条测试原样通过。

## 3. 踩坑：`declare module` 不带 import 会把 `Context` 打回类

把 `PracDshFace` / `PracWidgetsFace` 从 `service.ts` 挪进新建的 `contract.ts` 后，`vp check` 报 21 个错误，集中在 `ctx.provide` / `ctx.effect` / `ctx.inject`：

```
Property 'effect' does not exist on type 'Context'.
Did you mean to access the static member 'Context.effect' instead?
```

根因：`contract.ts` 里只有 `declare module "@deepseek-ai/cordis"`，没有 import 该模块——TS 把这个面当成**模块声明**而不是**增补**，消费者于是只看到 `Context` 的类构造面。`ui-frame/src/client/contract.ts` 早就写着这条（`import type {} from "@deepseek-ai/cordis"` + `export type { Context } from …`），新文件照抄后错误清零。另一个连带错误是 `ui-widget/src/client/service.ts` 里 `Side` 变成未使用（接口搬走了）。

复现/验证：`vp check packages/client` 由 21 errors → 0。

## 4. 守卫

新增 `scripts/verify-client-entries.mjs`（`pnpm verify:entries`），六条断言：入口名与 `clientPack` id、禁 `plugin.ts` / `lib.ts` / `./lib`、`dsh.client.platform` 与 `./client`、`client-types` 来源与产物名、`check:client` 存在、client 包之间无 value import / re-export。反例验证：临时在 `ui-widget` 放一个 `import { DSH_SIDEBAR_VIEW } from "prac-client-ui-dsh"`，gate 变红（exit 1），删除后恢复 0。

## 5. 验证记录（2026-11-02）

- `pnpm build`：13 个包通过；`dist/` 下 `ui-dsh` / `ui-widget` / `ui-changed-files` 不再有 `lib.js` / `lib.d.mts`，`ui-frame` / `ui-dsh` / `ui-widget` / `vscode-host` 有 `client-types.d.mts`。
- `pnpm exec vp run -r check:client`：7 个 loader artifact 全部 `ok`（id / externals / exports `apply,name,inject`）。
- `pnpm test`：全 workspace 通过（`ui-workbench` arrangement 20 条）。
- `node scripts/dsh-types.mjs --compare`：11 个包对得上 checkout。
- `node scripts/verify-ui-packages.mjs`：通过。
- `node scripts/verify-client-entries.mjs`：8 个包通过。
- `vp check packages/client`：0 type/lint error。
- `pnpm verify:ui`：在 `3184` 的一次性 rig 上跑完全部 live gate（containers / board / stack / split / grid / resize / persistence / space / bottom / views / file / editor / tabs / dynamic / lifecycle），全部 OK，最后一行 `UI ACCEPTANCE: all gates passed`——说明 arrangement 改从 `ctx.pracDsh` 取词、`./lib` 拆除与 contract 类型都没有改变页面行为。
- 遗留：`pnpm check` 仍因 **18 个与本次无关的文件**（`docs/ui-*.md`、`tests/gates/*`、`vendor/vscode/*`、`packages/bundle/web-app/package.json`）报格式化问题；`git status` 显示这些文件未被本次改动触碰，是既有状态。

## 6. 删除 `prac.view` 空座位（2026-11-03）

**现象**：`prac.view` 留着声明、`SlotMap` 条目和 catalogue 的 `"legacy"` 分支，但全仓没有生产者——`ui-vscode-views` 的 `SLOT = "prac.widget"`（`src/client/index.ts:37`），`ui-vscode-editor` 的 `SLOT: PracSlotKey = "prac.window"`（`src/client/index.ts:47`）。它是 kind 拆分（window / widget）之前的通用座位，代码先走了一步，座位没跟着删。

**改法**：删掉 `root` 的该 child 声明、`SlotMap` 条目与 `VIEW_SLOT` 常量；catalogue 只读 `prac.window` / `prac.widget`，`"legacy"` 从 `declaredViewSlots` 与 `declaredViewSlot()` 的类型里消失；`PracSlotKey` 收窄成 `"prac.window" | "prac.widget"`；`frame.ts` 的 `RenderSlot` 联合去掉该键。同轮清掉文档与注释里的旧词（`concepts.md`、`ui-surface-map.md`、bundle patch、两个适配器、vscode-host contract、workbench、`dsh-types.mjs`、vendor README / verify-views）。

**判断依据**：`slots.register({ name: "prac.view" })` 在全仓不存在；持久化里不会有这类 id；`declaredViewSlot()` 的消费点只把它折成 window（`services.ts:283`）。

**验证**：`pnpm build` ✅、`pnpm test` ✅、`pnpm verify:entries` ✅、`vp check packages/client` 0 error、`pnpm verify:ui` 全绿（`UI ACCEPTANCE: all gates passed`）。
