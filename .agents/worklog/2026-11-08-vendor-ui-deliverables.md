# Worklog: vendored `ui-deliverables`（过程/证据）

> 过程/证据，不签字；设计见 [tech-architecture](../notes/in-progress/2026-11-05-tech-architecture.md) 的「例外」条与 [prac-client-ui-deliverables](../../packages/client/ui-deliverables/README.md)。

## 1. 为什么走 vendored

- 目标：卡片继续用 DSH 的，只改「点开 change 去哪」——prac 的 VS Code diff，而不是 DSH 右栏 review tab。
- DSH 没有 open seam：卡片点击 → 注入的 `openChangesReview` → `ctx.sidebarRight.openResource`；slot entry 的 inject 面改不了，tab kind 接管只换 sidebar body。
- 发布物不含组件源码：`files` 只有 `lib/`，`./src/*` 在 npm 包里没有文件；想复用完整卡只能拿源码。
- James 裁决：接受 fork 例外，disable 上游；范围只此一个叶子。

## 2. 做法（anchor 0.2.1-alpha.2）

- 从 `dsh-prac-dev/packages/client/ui-deliverables/src` 复制到 `packages/client/ui-deliverables/src`（2,415 行，含 host half）。
- 唯一行为 diff：`src/client/index.ts` 的 `openChangesReview` 调 `open-changes.ts`；client inject 加 `pracVscode`；失败回退 upstream review tab。
- slot id / review tab id 加 `prac-` 前缀；其余文件逐字保留。
- `cordis.patch.yml`：`ui-deliverables` disable，insert `prac-client-ui-deliverables`；删掉旧的自绘卡 row。
- 删除 `prac-client-ui-changed-files`，保留 `prac.openTurnDiff` 与 `/api/prac-turn-diff.text`。

## 3. 踩坑

- **clientPack 默认只外部化 react**：第一次构建把 `dsh-client-ui-primitives`（含 Shiki）整个打了进来，client.js 从 ~95 kB 涨到很大、store 也会变成第二份 singleton。修法：`clientPack(..., { external: PLATFORM_MODULES })`，让 primitives / store / slots / dockkit / cordis 全部走 shell 的表。修后 client.js 94.84 kB、gzip 23.53 kB，`grep shiki` 为 0。
- **CSS 不会自动加载**：`clientPack` 把 CSS modules 拆成 `dist/style.css`，而 DSH loader 只读 `client.js`；upstream 用 tsdown 的 lightningcss 插件把样式内联进 bundle。补 `scripts/inject-css.mjs`：`vp pack` 之后把 `style.css` 作为带 `data-plugin-css` 的 `<style>` 插进 factory，client.js 94.8 kB → 109 kB。漏掉这一步的卡会完全无样式。
- **旧包名残留**：`prac-client-ui-workbench` 的 devDep、`tests/static/packages.ts` 的 boundary 列表都还写着 `prac-client-ui-changed-files`。前者让 `pnpm install` 直接失败，后者让 gate 少查一个包。
- **格式/命名**：upstream 用 PascalCase 文件、单引号无分号；prac 的 lint 要求 kebab-case。给 `unicorn/filename-case` 加包级 override，给 `fmt` 加 vendored src 的 ignore，保持逐字可 re-copy。
- **anchor 类型是旧的**：`dsh-types --compare` 现在会比对新装的 `ui-chat` / `ui-primitives` / `client-connection`，而 anchor worktree 的 `lib/types` 是 10-12 的旧构建（`ui-primitives` 的 `PermissionIconAutoReview` 只在 src 里、未重建），所以 gate 红。修法是 anchor 里 `tsc -b tsconfig.client.json`（或 `pnpm build`）；这不在 prac 仓内，未自动执行。另外 anchor 的 `packages/client/connection/src/browser-auth.ts` 有本地改动，重建后 `client-connection` 仍可能与发布版不同。
- **SessionId 漂移**：新装的 `@deepseek-ai/dsh-session@0.2.1-alpha.2` 把 `SessionId` 收成 branded type，`vscode-host` 里 `sessionIds.includes(current)`（`current: string`）因此报错。补 `SessionId` 的 type-only cast 与 devDep，行为不变。
- **许可证**：复制了 anchor 的 MIT `LICENSE` 到 vendored 包，README 写明来源与 diff。

## 4. 验证

- `vp pack`（新包）：host 13.01 kB / client 94.84 kB + CSS 注入后 109 kB；`check:client` 通过（loader id、externals、exports `apply,inject`，注入不新增 require）。
- `vp run -r build`：13 个包全绿。
- `vp check`（仓库根）：297 个文件格式 OK；230 个文件无 lint/type 错误。
- `node tests/static/entries.ts`：8 个 client 包通过。
- `node tests/static/packages.ts`：通过（更新包名后）。
- `vp run verify:ui -- smoke`：4 个 gate 全绿（shell 用新插件正常启动、无 console 错误）。
- `dsh-types --compare`：红，原因见上（anchor 旧构建），不是本次 copy 的类型问题。
