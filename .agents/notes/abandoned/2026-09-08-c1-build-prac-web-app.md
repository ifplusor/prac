---
status: abandoned:superseded
---

# Agent Note: C1 怎么搭 + 验证结果（最小可运行 prac-on-DSH）

Resolves the open decision in [2026-09-08-first-increment-c1.md](2026-09-08-first-increment-c1.md).

## Problem

C1 要搭一个**最小可运行的 prac-on-DSH**：一个 bundle + prac profile（叠 dsh-base + dsh-web-app），挂一个近乎为空的插件，确认能在 Web GUI 里加载/运行。这一步要回答的根本未知是：**独立消费者到底能不能扩展 DSH**。

## Decision

C1 用如下结构搭建（已在 `prac-dev` 落地并验证）：

- **bundle = `prac-web-app`**（对齐 `dsh-web-app` 命名，不带 scope），是 pra-c 的 web-surface 组合包。分布在 `packages/prac-web-app/`，由 **Vite+ (`vp`)** 管理构建（不用裸 pnpm）。
- **插件 = 注册一个可调用工具 `prac_ping`**：`ctx.tools.register(defineTool({ name:'prac_ping', ... }))`，返回 `{ok, name, version, time}`。直接验证 DSH 文档化的工具扩展点；schema 进入模型请求 → model-visible → logged。
- **profile 配法**：profile 是 home 薄组合，不走「项目目录 symlink」。用 `dsh plugin --profile <name> add <path>` 建。按蓝绿冻结定义三个 profile：
  - `prac`（稳定 web 面）：bundles = `[dsh-base, dsh-web-app, prac-web-app]`，`patchReload: live`；**目标是装 prac-main 的 bundle**（待 C1 验收后 promote 到位）。
  - `prac-dev`（开发面）：bundles = `[dsh-base, dsh-web-app, prac-web-app]`，`patchReload: startup`（dev 副本会被频繁改，去掉 HMR 抖动）；装 **prac-dev** 的 bundle。
  - `prac-headless-dev`（验证回路）：bundles = `[dsh-base, dsh-headless, prac-web-app]`，`patchReload: startup`；跟随正在验证的那份。
  - base / web-app / headless 是 in-box bundle（从 dsh 安装解析）；`prac-web-app` 是 out-of-tree（装进 profile 的 node_modules，`link:` 链接便于开发）。
  - **promote 时序（用户裁决）**：**先验收，再 promote**。验收已在 3081 web GUI 通过（`prac_ping` 返回 `ok/name/version/time`）。已完成：提交进 `dev` → merge `main` → 更新 `prac-main` worktree → 把 `prac` 的依赖换成 `prac-main` 的 bundle。
- **surface**：web 为主（C2 的 surface 基底 + 验收面），另有 `prac-headless-dev` 作 agent 可自动验证的端到端回路。
- **验证**：bundle 单测（worktree，不写 DSH home）为主 gate；`--dump-config` / headless 跑 / web 起服 用 `danger-full-access`；web GUI 由真人验收。
- `patchReload`: `prac` 用 `live`（稳定面无需防抖）；`prac-dev` 与 `prac-headless-dev` 用 `startup`（会被改 / 一次性语义）。

## Alternatives considered

- bundle 拆分：单 bundle（选）vs 多 bundle 骨架（decision/review/memory/plan 全建，YAGNI）。
- profile 放项目目录：**否**——DSH 固定解析 `$DSH_HOME/profiles/<name>`；改为「bundle 即分发单元」，profile 是 home 薄组合（更贴 DSH 标准扩展路径）。
- 插件形态：空插件 / 命令 / 上下文注入（均弱）vs 真工具（选）。
- surface：只 web / 只 headless（均取舍）vs web 为主 + headless 回路（选）。
- patchReload：startup（原 dev-env note）vs live（选，因 prac-main 稳定）。

## Verification results

- `vp pack` 产 `dist/index.mjs`（ESM）+ `dist/index.d.mts`；DSH 平台包保持 external（`--deps.never-bundle`）。
- `vp check --fix`：无格式/lint/类型错误。
- `vp test`：3/3 通过（mock 掉 DSH 缝，单测 bundle 自身贡献）。
- `dsh --profile prac-headless-dev --dump-config`：`prac-web-app` 行以 `insert` 排进组成树（provenance `# == prac-web-app`）。
- `dsh --profile prac-headless-dev "call prac_ping"`：**模型调用 `prac_ping` 成功**，返回 `{ok:true, name:'prac', version:'0.0.0', time}`。→ 独立消费者扩展 DSH 得证。
- `dsh --profile prac --port 3081 --no-open`：web 服务正常起服，`http://127.0.0.1:3081/?token=...`（401 未授权=需 token，符合预期）。→ 待真人开浏览器验收。

## Two friction findings (recorded, not conclusions)

1. **DSH 工具 value-schema DSL**：`defineTool` 的 `output.schema` 用**属性级** `required: true`，**不是**顶层 `required: [...]` 数组。首版我用了标准 JSON Schema 的顶层 `required` 数组，运行时在 `defineTool` 编译 schema 处报 `schema.required is not supported`。**类型检查/系统提示抓不到，只有真实 profile 运行才暴露**——验证环的价值。
2. **out-of-tree 消费者的类型摩擦**：`@deepseek-ai/dsh-tools` 的 `.d.ts` 会传递 import 一大批 `@deepseek-ai/*`（`dsh-agent`/`dsh-llm`/`dsh-session`/`dsh-scope`/`dsh-util-values`+cordis+schemastery），其闭包庞杂。C1 用**局部 ambient 声明**（`src/dsh.d.ts`）满足本包类型检查，真正正确性靠 runtime 验证。一个更干净的消费者类型故事是 C2+ 候选。

## Next open decision

C2：决策空间工具（基于已可运行的 web surface）。优先复用 `prac_ping` 已打通的工具注册 + 模型可见链，探索**「带依据的候选决策」**作为模型可见输入（需扩 `SessionEventMap`）。

## Related

- [2026-09-08-first-increment-c1.md](2026-09-08-first-increment-c1.md)（选 C1 的原因）
- [2026-09-08-dev-environment-worktrees.md](2026-09-08-dev-environment-worktrees.md)（开发环境：prac-main 冻结 / prac-dev 开发；DSH 基底 dsh-master 只读）
- [../../../docs/architecture.md](../../../docs/architecture.md)（bundle/profile/plugin 映射）
- 源码：`packages/prac-web-app/`（src/index.ts、src/dsh.d.ts、tests/、cordis.patch.yml、package.json、vite.config.ts）
