---
status: in-progress
---

# prac dev 的 DSH 锚点：一个 worktree、一条比较门

## Problem

prac 的类型检查用 **npm 上发布的** DSH 包，而 app 跑的是某个 checkout。两者一旦不是同一份，上游给缝加成员时**我们不会红**：实测 `@deepseek-ai/dsh-client-ui-sidebar-right` 激活时读 `layout.panelInfo`，prac 手抄的 `LayoutFace` 没有发布它，整个外壳因此不激活（12 个条目不激活，唯一报错是 `getSnapshot` of undefined）。那次漂移是活的 rig 抓到的，不是编译器。

## 决定

- **锚点是一个 worktree**：`../../deepseek-harness/dsh-dev`（分支 `james-dev`，版本 `0.1.5-rc.1`）。prac dev 的 rig 从这里启动，类型也以它为基准 —— 同一个 DSH，两个用途。
- **catalog 精确 pin 锚点的发布版本**（`0.1.5-rc.1`；`latest` 指向很旧的 release，所以范围会解析错）。
- **一道门**：`scripts/dsh-types.mjs --compare` 在 `pnpm check` 里逐字节比较**已安装的** `lib/types` 与锚点（默认锚点路径，`--checkout` / `DSH_CHECKOUT` 可覆盖；机器上没有锚点时跳过并说明，pin 仍让仓库可移植）。这正是漂移的防线，也报告"哪个包根本没构建过"（`dsh-dev` 的三个包曾如此；重建后 11 个包全部逐字节相同）。
- **前进是三步一起**：更新锚点 worktree（`pnpm install && pnpm build`）→ 改 catalog 的版本 → 跑 `pnpm check`（比较）。只做其中一步不算前进。
- **下一站的 worktree 已备好**：`../../deepseek-harness/dsh-prac-dev`（分支 `prac-dev`，从 `master` 起，`0.2.1-alpha.2`）已 install + build 过；它对应的 rig 上 14 道门全绿。

## 已知的边界（实测）

- **发布版本会被重发**：同一个 `0.1.5-rc.1`，装出来的副本与锚点的 checkout 曾差两个文件（`dsh-api-session-controller` 的 `client/contract/session.d.ts` 与 `client/session-wire-event.d.ts` 只出现在安装副本里）。pin 钉得住名字、钉不住内容；比较门是唯一能看见这件事的地方。
- **上游构建出的 `d.ts` 用 `./x.ts` 说明符**（`lib/types/client/index.d.ts` 里 `import { SlotRegistry } from './registry.ts'`）。后果是同一个 d.ts 可能以**两条 module record** 进入我们的 program：`Context` 的 augmentation（`ctx.slots` / `ctx.layout`）与直接 import 的同名类型对不上（实测：`SlotRegistry` "Property `clearStoreScope` is missing"、"separate declarations of a private property `_core`"、`MainPanelId` 少 brand），跨包的 declaration merge 也不生效（`SlotMap` 的 `shell.overlay` 收窄成 `never`）。`web-app` 现有的两处断言（`const slots: SlotRegistry = ctx.slots`、`ctx.layout satisfies ILayout`）在**某些内容的安装**下会因此红 —— 而它们正是把 DSH 槽位键拉进该 program 的手段。
- **所以"在发布点写 `satisfies ILayout`"现在写不成**：手抄的 face 必须保持结构化类型 —— 一旦从 prac 自己的 `ui-layout` 里去 import DSH 的 `ILayout`，消费者那边的 `SlotMap` augmentation 就落到另一条 record 上（`shell.overlay` 变 `never`）。防线只有上面那道比较门。
- **`link:` 到 checkout 不能解决**：pnpm 的 catalog 不接受 `link:`（v12.3.4 报 "not yet supported"）；改用 `pnpm-workspace.yaml` 的 `overrides` 装得上，但 record 分裂依旧（分裂来自 d.ts 里的 `.ts` 说明符，不来自副本数量），而且 `@deepseek-ai/dsh-lsp` 在 `dsh-dev` 里没有对应包。

## Alternatives

- **`tsconfig` 的 `paths` 覆盖**：试过并否掉 —— 它同样把 declaration merge 的模块切成两份 identity，报假错（`slots.register` 重载失配，而同一 import 的 `keyof SlotMap` 仍有那个键）。
- **直接用上游的 `dsh-master`**：那是协作方的工作 checkout，会在会话中切分支（实测：`master` → `dsh-v0.2.0-rc.2` → `master`）。prac 的锚点不跟着别人的工作树动。

## Open questions

- **怎么让消费不再受 record 分裂影响**：prac 自己声明它用的那条缝（`SlotMap` 的键 + 它所读的 `Context` 成员形状，放进 prac 自己的 `.d.ts`），还是请上游把构建出的 `d.ts` 说明符改成 `.js`。前者在我们这边可做，后者是根因。
- **锚点跟着哪条线走**：跟 release，还是跟某条 feature 分支（`dsh-dev` 是 `james-dev`）。现在是"要一个上游成员时就前进一次"。
- **缺锚点时是否还算通过**：现在是"跳过 + 说明"；要让 CI 也守漂移，需要一条硬要求。
