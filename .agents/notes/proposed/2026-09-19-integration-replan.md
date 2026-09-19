---
status: proposed
---

# Agent Note: 重新规划融合方案（假设变了之后）

## Problem

这份规划的**前提**在最近两轮核实里变了几条：能力面的意义被削弱、agent/chat 归了 DSH、扩展的位置变成了我们的选择。原来那条主线（"把 VS Code 的能力拆散带入 prac：能力层暴露给 agent、UI 层拆散成组件、两半之间按 DSH 的架构重做通信层"）是**在这些前提成立时**推出来的，现在要重推一遍。

这篇只做一件事：**把变了的假设逐条摆出来，给出新的决策轴与代价，并指出哪些旧 note/docs 会跟着动**。选哪条由 James 定。

## 变了的假设（原假设 → 现在的事实 → 影响）

1. **"诊断是 agent 的一类能力"** → 诊断是**推-only 的有损缓存**：触发在扩展手里、每次 `set()` 只保留 1000 条/文件（另加一条"还有 N 条"）、`modelVersionId` 写进去没人读、另一半（任务问题匹配 / 设置校验 / notebook / MCP / prompt）**只产在渲染器**里。参见 [`docs/vscode.md`](../../../docs/vscode.md) 的「诊断这条线」。
   ⇒ "agent 通过能力面拿到诊断"实际是"agent 读到别人某次跑完的结果"；它不该被当成一等能力（验收 1 的写法要改）。
2. **"把 VS Code 的能力暴露给 agent"** → 请求/响应那类能力（语言特性、命令）**由主线程发起**（注册表在主线程）；但扩展可以**不碰 extHost 协议**就拿到它们：`vscode.execute*Provider`（**24 个**，`api/common/extHostApiCommands.ts` 把公开名映射到渲染器的 `_execute*`）＋ `commands.executeCommand`（另有 3 个非 `*Provider` 的 `vscode.execute*`）。
   ⇒ agent 要语言智能，**不一定需要我们实现主线程**——写一个扩展就行；代价是**要页面在**（今天扩展宿主由渲染器发起，没页面就没扩展宿主）。
3. **"保留完整扩展生态"的含义** → agent/chat 面归 DSH（James 2026-09-19，见 umbrella §3.7）。⇒ VS Code 的 chat / participants / 工具注册表 / 会话 / `platform/agentHost` 都不进 prac 的 agent 面；**扩展注册的 LM tools 我们拿不到**（要用就等于把它的 agent 面搬过来）；生态对 agent 真正开放的接口收窄成 **MCP**（工具协议）与**文件定制**（`SKILL.md` / `*.instructions.md` / `AGENTS.md`）。
4. **"两半之间的通信层要重做"** → 这句话的动机原来是"能力暴露给 agent + UI 组件由能力面驱动"。上述三条把动机拆掉了两条（诊断不值、agent 面归 DSH），只剩"agent 要用 VS Code 的服务（语言智能 / 命令 / 扩展生态）"这一条——而那条**有另一条便宜的路**（见轴 1）。
5. **"UI 层拆散成组件"** → 与 VS Code 的构造方式相抗：part 由服务 eager 造（`part.ts:61` 自注册进 layout service）、注册表（语言特性、命令、marker）都在渲染器、workbench 的 chat 我们不要了。今天整包 workbench 挂在 part host 里是**能用的**（Error Lens、tree view、语言特性都活着）。⇒ 拆散要重新论证收益。
6. **"扩展在哪跑"** → 变成**我们的选择**：`extensionKind` 只是扩展的声明，真正决定"这棵树里的 `myExtensions` 是谁"的是**主线程那一侧**（`isHostExtension` 判定 + 初始化时给扩展宿主的清单）。⇒ 多了一根杠杆，也多了"UI-kind 扩展被指到 server 侧会挂住"的坑。
7. **"扩展只能在渲染器里干活"** → 上游本来就把"算在哪、呈现到哪"分开了：装饰走 `MainThreadTextEditors.$trySetDecorations`、状态栏走 `MainThreadStatusBar`、命令走 `MainThreadCommands.$executeCommand` ⇒ **扩展可以在 server 侧扩展宿主里跑，像素由主线程代理到页面**。
   ⇒ "UI 组件必须是 client 侧"这条**部分失效**：真正必须在 client 侧的只有"像素与输入"，不是"扩展"。

## 重新规划：五条轴

> 每条给选项与代价；「倾向」只是建议，不是结论。

### 轴 1 · agent 的 IDE 能力从哪来（最关键）

| 选项 | 是什么 | 代价 |
| --- | --- | --- |
| **1a 文件 + 命令** | agent 只用工作区文件、DSH 自己的 exec/terminal、git；语言检查靠它自己跑 `tsc`/`eslint`/`ruff` | 拿不到人在用的那套语言服务器与扩展能力（配置/版本可能不一致）；零协议 |
| **1b 我们写扩展 + MCP** | 在扩展宿主里写一族扩展，用 `vscode.execute*Provider` / `commands` / `languages.getDiagnostics` 把能力暴露成 **MCP server**（或 DSH 能消费的接口），DSH 当 MCP 客户端 | **需要页面在**（今天：没页面就没扩展宿主）；需要定义"暴露哪些能力"；MCP 之外不碰 VS Code 协议 |
| **1c broker 当 agent 侧的扩展宿主** | 主干自己起一个 ExtensionHost 连接（无页面），实现**实测需要的**那部分主线程面 | 要写主线程实现（按扩展实际调用补，不按接口全量）；可能与人的扩展宿主**重复激活**（两份 cSpell / TS server）、状态两份；要处理"UI-kind 扩展挂住" |

**倾向**：先做 1b 的探针（便宜、能证伪"扩展里拿得到语言智能"），1c 降级为"1b 不够用时才做"。1a 永远作为兜底（agent 总能在工作区里跑自己的工具）。

### 轴 2 · 人的界面怎么来

- **2a 保持现状（整包 workbench 挂 part host）**：已落地、生态可用；chat 归 DSH ⇒ 我们要从 workbench 拿的正好是它的强项（编辑器 / 诊断 / 终端 / SCM / 搜索）。
- **2b 拆成 UI 组件**（原方案）：需要论证收益——今天没看到"整包"做不到而我们非做不可的事，只看到拆散的成本（part eager、注册表在渲染器、CSS 承重）。
- 两者可以并存（2a 为底，个别座位按 2b 拆）。

**倾向**：2a 为主，把 2b 从"目标形态"降级为"个别座位的可选手段"。

### 轴 3 · 能力面还要不要

- 能力面（`snapshot / subscribe / settled / version / actions`）原来的两个消费者是"UI 组件"与"agent"：轴 2 保持现状 ⇒ UI 侧不需要它；agent 面归 DSH、能力走 MCP/工具 ⇒ agent 侧也不需要它。
- **选项**：① 整体撤掉（省一层抽象）；② 只保留"给 agent 用的能力面"，作为 DSH 工具的**宿主接口**（MCP 之外的自有形状）；③ 保留原样（等 UI 组件事后再用）。

**倾向**：①或②（看轴 1 选 1b 还是 1c）；③ 的前提（UI 组件）已经不成立。

### 轴 4 · 工作区与权威

- code server 已经拥有 IDE 侧的工作区（`--folder` 不传、工作区由 client 的 boot 决定）；DSH 的 exec / terminal / 工具在**同一个目录**上操作。
- 要定的是：**谁监听文件变化、谁处理冲突、谁是"当前工作区"的真源**（现在事实上是 DSH 的会话/工作区注册表 + client 的 boot 答案，两者没有对账）。
- 选项：① DSH 为真源，code server 跟随（改工作区 = 重建/导航）；② code server 为真源，DSH 跟随；③ 名义上同一份、谁都不改（只读对账）。

### 轴 5 · MCP 客户端与文件定制（轴 1 选了 1b/1c 才有意义）

- **MCP 客户端归谁**：DSH 自己起（推荐）／用 VS Code 的 `contrib/mcp`（等于取它一部分 agent 面）／两边各起。
- **文件定制是否共源**：`SKILL.md` / `*.instructions.md` / `AGENTS.md` 是纯文件——共源（一个真实源，跟随上游格式）／只共 `AGENTS.md` 这类仓库事实／各用各的。

## 两个先做的探针（验证优先于表态）

1. **探针 A（半天，验轴 1b）**：写一个最小扩展（在 code server 的扩展宿主里），做两件事：`commands.executeCommand('vscode.executeHoverProvider', …)` 与 `languages.getDiagnostics()`，把结果写进日志/回给 DSH；再关掉页面重复一次。**看**：能不能拿到；没页面时是断连、超时还是报错。
2. **探针 B（1–2 天，验轴 1c）**：主干起一个 ExtensionHost 连接（不经页面），按已有证据发三条初始化推送，实现 `ExtensionService` + `Errors` + `Documents` + `Diagnostics` 最小面，装 cSpell 看它是否激活并推诊断。**看**：无页面扩展宿主能不能真跑起来；人那份扩展宿主是否受影响（重复激活/端口/状态）。

两个探针都是"能不能"的问题，做完再选轴，比现在争论便宜。

## 现有 note/docs 会跟着动（等裁后执行）

- [2026-09-16-vscode-integration-transport.md](2026-09-16-vscode-integration-transport.md)：它的"broker + 三层回答 + 文档权威"是**轴 1c 的方案**。轴 1 若选 1b，它降级为备选（大部分内容仍有效，但优先级变了）。
- [2026-09-15-vscode-capabilities-into-prac.md](2026-09-15-vscode-capabilities-into-prac.md)：能力清单要按"人看的 / agent 用的"重划（轴 3 的决定决定它还剩什么）。
- [umbrella](../in-progress/2026-09-09-vscode-dsh-integration.md)：§1 的两条主线陈述（09-09 / 09-15）、§3.7 生态与能力、§4 的差距表都要按新轴线重写。
- `docs/architecture.md`：§3.3（通信层约束）、§3.4（UI 组件的边界）、§4.1/§4.2（两端与状态归属）、§5.1/§5.2（两个系统提供什么）、§6.3（能力面）、§7（尚未定的设计）——按重规划结果改。

## Open questions

1. **轴 1 选哪条**（1a / 1b / 1c，或"先 1b 再按需 1c"）——这条决定其余四条轴的取值范围。
2. **轴 2**："整包 workbench"是**目标形态**还是**临时形态**？（影响要不要继续投 UI 组件的方向）
3. **轴 3**：能力面撤掉、缩到"agent 侧"、还是保留？（现在是"没有任何实体"，撤掉是零成本）
4. **轴 4**：工作区真源归谁；冲突怎么判。
5. **轴 5**：MCP 客户端归谁；文件定制是否共源。
6. **探针先做哪个**（还是两个都做）。

## Related

- [../in-progress/2026-09-09-vscode-dsh-integration.md](../in-progress/2026-09-09-vscode-dsh-integration.md)：主线、需求约束与已定的决定（§3.7 的"agent/chat 归 DSH"是本文的直接输入）。
- [../../worklog/2026-09-09-vscode-dsh-integration.md](../../worklog/2026-09-09-vscode-dsh-integration.md)：依据（协议清单、已核实事实、决定台账）。
- [../../../docs/vscode.md](../../../docs/vscode.md)：VS Code 的内部结构（两半、平台服务、诊断这条线、agent/MCP/tool/skill/prompt 的层次）。
- [../../../docs/architecture.md](../../../docs/architecture.md)：现在的目标架构（本文若通过，改的就是它）。
