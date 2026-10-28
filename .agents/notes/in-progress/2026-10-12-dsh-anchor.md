---
status: in-progress
---

# prac dev 的 DSH 锚点：一个 worktree、一条 pin、一条比较门

> **Package architecture migration（2026-10-28）**：本 note 的 `web-app` / `vscode-host` 是实现期名字。目标划分见 [2026-10-20-ui-framework.md](2026-10-20-ui-framework.md) 的 Package architecture：几何 → `ui-frame`；surface / isolation → `ui-surface`；application / window → `ui-application` / `ui-window`；board / widget → `ui-widget`；默认工作台 / arrangement → `ui-workbench`；VS Code adaptor → `ui-vscode-host` / `ui-vscode-views` / `ui-vscode-editor`；DSH → `ui-dsh`；`bundle/web-app` 只做 composition root。

## Problem

prac 的类型检查用 npm 上发布的 DSH 包，而 app 跑的是某个 checkout。两者一旦不是同一份，上游给缝加成员时**我们不会红**：实测 `@deepseek-ai/dsh-client-ui-sidebar-right` 激活时读 `layout.panelInfo`，prac 手抄的 `LayoutFace` 没有发布它，整个外壳因此不激活（12 个条目不激活，唯一报错是 `getSnapshot` of undefined）。那次漂移是活的 rig 抓到的，不是编译器。

## 决定

- **锚点是一个 worktree**：`../../deepseek-harness/dsh-prac-dev`（分支 `prac-dev`，从 DSH 的 `master` 起，`0.2.1-alpha.2`）。prac dev 的 rig 从这里启动，类型也以它为基准 —— 同一个 DSH，两个用途。
- **catalog 精确 pin 锚点的发布版本**（`0.2.1-alpha.2`；`@deepseek-ai/cordis` 随之 `4.0.5-alpha.1`，prac 各插件对它的 peer 范围同样跟锚点走）。
- **一条比较门**：`scripts/dsh-types.mjs --compare` 在 `pnpm check` 里逐字节比较**已安装的** `lib/types` 与锚点（默认锚点路径，`--checkout` / `DSH_CHECKOUT` 可覆盖；机器上没有锚点时跳过并说明，pin 仍让仓库可移植）。它还报告"哪个包根本没构建过"。
- **前进是三步一起**：更新锚点 worktree 的源码 → **`pnpm run clean && pnpm build`**（增量构建会留下上一版产物与陈旧 `lib/types`；实测一次 clean 删掉 348 条路径）→ 改 catalog 的版本 → 跑 `pnpm check`（比较 + 类型）。只做其中一步不算前进。

## 槽位契约的归属（这一轮最有用的一条）

`SlotMap` 是**声明合并**的表，`ui-slots` 的契约写明 *"Owners declare slot contracts by merging into `SlotMap`"*，并且 *"consumer `declare module` augmentation merges with declarations **lexically in the augmented module**, not with re-exports"*。运行时一侧则完全是动态的（`entries(key: string)` / `specDynamic(key)` / `subscribe(key: string)`；未声明的键就是 `undefined`），`ChildrenDecl` 只接受已声明的键 —— 所以"声明一个新槽"是类型层面的动作，而"读一个槽"不是。

由此得到 prac 的规矩：

- **键由拥有者声明**。prac 现在就是**帧的所有者**（它 publish `ctx.layout`、自己做 `root` 注册），所以 `sidebar` / `main` / `rightbar` / `shell.overlay` 与 `prac.view` 一起写在 prac 的槽声明里（`ui-frame` / `ui-widget`）—— 不再由 `web-app` 去 import DSH 的 `ui-layout` 借那四个键。
- **消费者只取拥有者的声明，不做比较**：`import type {} from "@deepseek-ai/dsh-client-ui-renderer/client"` 把 `Context.slots` 带进 program；不再写 `const slots: SlotRegistry = ctx.slots` 或 `ctx.layout satisfies ILayout` 这类**跨 record 断言**（augmented `Context` 成员与直接 import 在 `nodenext` 下是两条 module record，比较不可能成立）。
- **消费者读的是构建出的 `dist/client.d.mts`**：改了声明必须 `vp run -r build` 才生效 —— 本仓库的 client 半以 DSH 的 loader 契约打包，`./client` 的 `types` 指向 `dist/client.d.mts`。这一点曾让"声明已经写了、消费者却看不见"看起来像打包器丢了 ambient 声明。

## 已知的上游事实（实测）

- **发布版本会被重发**：同一个 `0.1.5-rc.1`，装出来的副本与当时的锚点 checkout 差两个文件（`dsh-api-session-controller` 的 `client/contract/session.d.ts` 与 `client/session-wire-event.d.ts` 只存在于安装副本）。pin 钉得住名字、钉不住内容；比较门是唯一能看见这件事的地方。
- **构建出的 `d.ts` 用 `./x.ts` 说明符**（`lib/types/client/index.d.ts` 里 `import { SlotRegistry } from './registry.ts'`）。同一个 d.ts 因此可能以两条 module record 进入消费者 program（`SlotRegistry` 报 "separate declarations of a private property"、`MainPanelId` 少 brand），"跨包借键"就是这样失败的。prac 用归属划分绕开了它；要根治得让构建产物用 `.js` 说明符。
- `link:` 到 checkout 不能替代 pin：pnpm 的 catalog 不接受 `link:`（v12.3.4 报 "not yet supported"）；`pnpm-workspace.yaml` 的 `overrides` 装得上，但 record 分裂与它无关（分裂来自说明符），而且 `dsh-dev` 里没有 `@deepseek-ai/dsh-lsp` 对应的包。

## Alternatives

- **`tsconfig` 的 `paths` 覆盖**：试过并否掉 —— 它同样把 declaration merge 的模块切成两份 identity，报假错（`slots.register` 重载失配，而同一 import 的 `keyof SlotMap` 仍有那个键）。
- **直接用上游的 `dsh-master`**：那是协作方的工作 checkout，会在会话中切分支（实测：`master` → `dsh-v0.2.0-rc.2` → `master`）。prac 的锚点不跟着别人的工作树动。
- **`dsh-dev`（`james-dev`，`0.1.5-rc.1`）**：曾作为锚点（它与当时的 pin 一致），现在留在树上作参照；它有三个包的构建早于源码（clean 后消失）。

## Open questions

- **锚点跟着哪条线走**：跟 release（`alpha` dist-tag），还是跟某条 feature 分支。现在的节奏是"要一个上游成员时就前进一次"。
- **缺锚点时是否还算通过**：现在是"跳过 + 说明"；要让 CI 也守漂移，需要一条硬要求。
- **要不要把 `./x.ts` 说明符反馈给上游**：它对 prac 不再是阻塞（归属已划分），但对任何"借另一个包槽键"的消费者仍然是。
