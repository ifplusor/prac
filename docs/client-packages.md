# Client packages

Every package under `packages/client/` is a **DSH plugin row**, not a library. A package therefore has one loader entry, an optional type-only contract, and nothing else importable. Cross-package sharing goes through Cordis services (values) and `import type` (types); there is no second artifact.

## Shape

| Path                     | Role                                                                                      | Builds to                          |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| `src/index.ts`           | Host half: `export function apply(): void {}`                                             | `dist/index.mjs`                   |
| `src/client/index.ts`    | Client half: the loader entry and the package's public module (`name`, `inject`, `apply`) | `dist/client.js` (loader artifact) |
| `src/client/contract.ts` | Optional type-only contract: `Context` / `SlotMap` merges and face types                  | `dist/client-types.d.mts`          |
| `src/client/<domain>.ts` | Implementation: stores, services, chrome, adapters                                        | —                                  |

No `plugin.ts`, no `lib.ts`, no `./lib` export, no second build. The plugin body **is** the entry: assembly lives in `index.ts`, and code that grows too large moves into a domain module rather than into a differently named body file.

The host half is empty because these mechanisms are browser-only, but every bundle row is imported on both planes, so the file must exist.

## Cross-package sharing

| What               | Channel                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Values / behavior  | A Cordis service (`ctx.pracFrame`, `ctx.pracDsh`, `ctx.pracWidgets`, …); consumers list it in `inject`.          |
| Types              | `import type { … } from "prac-client-<name>/client"` — served by the `types` condition of the `./client` export. |
| Same-package tests | Relative imports of internal modules (`../src/client/frame.ts`).                                                 |

**A client package must not import another client package's values**, directly or by re-export. Two module records for one value is a real divergence as soon as the value carries state, and the sanctioned channel for state is a service anyway.

The contract file is type-only for a mechanical reason: the loader artifact is a closure with a banner/footer, so a declaration bundle built from the entry would not parse. `src/client/contract.ts` is built separately and published on `./client.types`. It must import the modules it augments (`import type {} from "@deepseek-ai/cordis"`) — a bare `declare module` alone leaves consumers seeing only the merged members, without `ctx.effect` / `ctx.provide`.

## Artifact and manifest

- `package.json` declares `dsh.client.platform: "web"` and exports `.`, `./client` (`{ types?, default: "./dist/client.js" }`), `./package.json`.
- When types are published they land at `dist/client-types.d.mts`; the source is `src/client/contract.ts`.
- The loader artifact is built by `scripts/pack-client.ts` (`clientPack()`), which stamps the package name as the bundle id and keeps the platform words external.
- `vite.config.ts` declares a `check:client` task: loader closure present, id equals the package name, every `require` answerable, no inlined React, exported surface `apply,name,inject`.
- The bundle row's `id` equals the package name and is registered in [packages/bundle/web-app/cordis.patch.yml](../packages/bundle/web-app/cordis.patch.yml).

## Adding a client package

1. `package.json`: name, `private`, `main`, `types`, `exports` (`.` + `./client`), `dsh.client.platform: "web"`.
2. `src/index.ts`: the empty host `apply`.
3. `src/client/index.ts`: `name` / `inject` / `apply` and whatever the package publishes.
4. `src/client/contract.ts` **only** if other packages need this package's types.
5. `vite.config.ts`: host entry, `clientPack("<name>", { entry: "src/client/index.ts" })`, `check:client`, and a `client-types` entry when `contract.ts` exists.
6. Register the row in the bundle patch.
7. Run `pnpm verify:entries` and `pnpm build`.

## Enforcement

`scripts/verify-client-entries.mjs` (`pnpm verify:entries`) asserts, per package:

1. `src/client/index.ts` exists, and every `clientPack()` call names it with the package's own id;
2. no `plugin.ts` / `lib.ts`, no `./lib` export;
3. `dsh.client.platform` is `web` and `./client` points at `dist/client.js`;
4. a declared `./client.types` comes from `src/client/contract.ts` and lands at `dist/client-types.d.mts`;
5. a `check:client` task is declared;
6. no value import or re-export of another `prac-client-*` package.

`scripts/bundle-client.mjs` then checks the emitted artifact's shape. File and subpath names follow [file-naming.md](file-naming.md); this page owns the roles.
