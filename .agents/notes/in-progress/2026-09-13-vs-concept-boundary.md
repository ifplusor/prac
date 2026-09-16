---
status: in-progress
---

# Agent Note: prac 与 VS Code 的概念边界与命名

> 位置：这条是一项**已完成工作的决策记录**（实现与验收都已完成）。**James 2026-09-15 决定：状态先保持 `in-progress`**，暂不转 `resolved:implemented`。umbrella 见 [2026-09-09-vscode-dsh-integration.md](2026-09-09-vscode-dsh-integration.md)；下一步（把能力拆散带入 prac）见 [../proposed/2026-09-15-vscode-capabilities-into-prac.md](../proposed/2026-09-15-vscode-capabilities-into-prac.md)。

## Problem（2026-09-13）

prac 同时说三套词：DSH 的（slot / 视图 / 服务）、prac 自己的（frame / region / seat / view）、VS Code 的（workbench / part / monaco / `IWorkbench…`）。融合越深，第三套词越容易从"边界上的适配"扩散成 prac 内部的常用语——那时它不再是实现细节，而是 prac 的词汇表被上游改写。

**James 的裁决**：prac 中使用的**所有 VS Code 概念要收束**，存在**一个清晰的转换界面**；边界之外的 prac 内部应使用**自己的或贴近 DSH 的**体系。

## 决定

1. **包名允许出现来源词**（`vscode` / `vs` / `vsc`）：VS Code 的那些 UI 包**事实上就是桥接层**，尊重客观事实。带来源标签的 id（`vs:editor`）照此办理。
   - **放弃了什么**：原 C 档"改名收束"的最大代价（改名级联）因此消失；换来的是"包名不是 prac 词"这一点不纯粹——接受。
2. **跨平面契约用共享常量模块 + 构建期内联**（不引入运行期耦合，也不依赖 DSH 的配置通道）。
   - **放弃了什么**：一个"只放常量的最小模块"的额外包；改为让**上游本家的包**（`prac-vscode`）承担这个角色（它的 `.` 入口就是契约）。
3. **`part` 只做边界词**：对外的面上用 `partHost`，机制内部只用 `view` / `region`（`ui-layout` 里没有 `part`）。
4. **机制不知道任何来源词**：`ui-layout` 判"这是不是座位"按**注册表成员**（`slots.entries("prac.view")`），不按 id 前缀。原 `VS_VIEW_SOURCE` 删除。
   - **放弃了什么**：按前缀判定的一点便利；换来的是"机制与来源解耦"这条原则真正落地。
5. **通道：全局不是唯一可行，DSH service 才是合规载体**。机制 → 编排用 `ctx.provide`；座位注入服务（`inject: ["pracVscode"]`）。
   - **代价（已知并接受）**：坏组合（抽掉机制行、留座位行）从"渲染空白"变成"fiber 挂起"（DSH loader：依赖缺失的 fiber 保持 pending）。
   - **必须留全局的只有补丁侧**：设置/读取它的代码跑在 workbench bundle 内部，既不在 DSH 模块图里也不在 Cordis 上下文里——这是结构性的。修法是把它换进 `create()` 的 construction options（S2），已做。
6. **判据（怎么算收束了）**：
   1. 上游内部标识只出现在边界里（`workbench.parts.*`、`monaco-workbench`、`vs`/`vs-dark` 主题类、`_VSCODE_FILE_ROOT`、`remoteAuthority`/`serverBasePath`/`callbackRoute`/`productConfiguration`/`workspaceProvider`、`workbench.web.main.internal.js`）；
   2. 越界到 prac 的只能是 prac 词（`prac.view`、`partHost(viewId)`、同源路由 path、带来源标签的 id）；
   3. 机制不知道任何来源词；
   4. 任何一个越界契约**只定义一次**。

### 为什么这样选（放弃了什么）

- **S2：补丁交互面走 `create()` 的 construction options**。那是一条**既有**路径（`IWorkbenchConstructionOptions`），补丁本来就持有 `IBrowserWorkbenchEnvironmentService.options`；全局通道（`__pracVsPartHost` 入 / `__pracDeferVsParts` 出）是**我们自己造的第二个协议**，而且是窗口上的隐式约定。
  - **放弃了**：把 sink 塞进 options 带来的**隐式耦合**（当时列为"未验证、不建议"的替代方案，最终选了 S2 的显式字段）。
  - **顺带收获**：删掉客户端的 **50ms 轮询**；契约成为可 `grep`、可 `diff` 的一份原件。
  - **收束的是四样东西**：入方向（defer 标志）、出方向（part-hosting face）、契约常量（options 字段名）、类型（face 的形状）。
- **交互面走 service 而不是全局**：全局不是"唯一可行"，只是"模块图之外"的一个选择；Cordis 的 service 注册表才是 DSH 给的合规载体，且同一仓的"机制 → 编排"那条边已经这么做。
  - **放弃了**：座位对"边界还没发布"的**宽容**（`?.` → 渲染 `null`，之后靠重渲染接上）。
  - **换来**：顺序由框架保证——座位只在机制发布之后激活。
  - **代价（已实测，不再是推断）**：坏组合（抽掉机制行、留座位行）从"渲染空白"变成 **fiber 挂起**——实测报 `2 entries did not activate` + `pending (waiting for service: pracVsHost)`、`regions: 0`。
- **服务不用 `Service` 基类**：这个面没有自己的生命周期，也没有按组隔离的需要。
  - **留下的条件**：等这个面长出生命周期、或要按组隔离时再换。
- **`part` 只做边界词**：对外的面上用 `partHost`，机制内部只用 `view` / `region`。
  - **放弃了**：机制里直接用上游词的那点省事。

## 2026-09-15：命名收束（执行完成）

**James 的裁决**：vendor 采用 **A 档命名**（`vendor/vscode` = pin + patch + 构建配方 + 载荷；**新增 `vendor/vscode-embed`** = prac-free 的 wrapper lib）；prac 侧**把 `workbench` 换掉**（换法不是发明新词，而是把上游的词关进 vendor）；**补丁载荷一并去 prac 名**。

### 分界线（这次确立的规则）

| 词 | 归属 |
| --- | --- |
| `workbench`（概念、`workbench.parts.*`、`.monaco-workbench`、`out/vs/workbench/…`、`.build/vscode`） | **vendor**——上游的词：part id / CSS 类 / 路径，改了会坏 |
| `vscode` | **产品身份 token**：vendor 的目录与包名 ＋ prac 侧指代那个实例与它的资产（路由、服务、view id、surface id） |
| prac 自己的词（frame / region / seat / view / slot / arrangement） | **prac** |

不用 `ide`：prac 论述里 `IDE` 是**能力**（"保留完整 IDE 能力"、"可按需下潜的重工具"），不是实例，拿它当实例 token 会撞概念。

### 实际改动

- **vendor**：`pracVsPartHost.ts` → `embeddedWorkbench.ts`（`PracVsPartHost` → `EmbeddedWorkbench`）、`pracWebMain.ts` → `embeddedWebMain.ts`（`PracBrowserMain` → `EmbeddedBrowserMain`）、`pracBridge.ts` → `embedBridge.ts`；契约标识符 `PRAC_VS_BRIDGE`/`"pracVsBridge"` → `EMBED_BRIDGE`/`"vscodeEmbed"`、`PracVsBridge` → `EmbedBridge`、`PracVsPartHostFace` → `PartHostFace`、`readPracVsBridge` → `readEmbedBridge`；**新增 `PART_HOST_ATTR`**（原先这个属性名在载荷、client、`page.html`、5 个闸门脚本里各拼一遍）。补丁只剩 import 名一行变化（仍是 74 行 delta-only）。
- **prac**：`/prac-workbench` → `/prac-vscode`、`#prac-workbench-boot` → `#vscode-embed-boot`、`__pracWorkbench*` → `__vscodeEmbed*`、服务 `pracVsHost` → `pracVscode`、面类型 `PracVsHostFace` → `PracVscodeFace`、view id `vs:editor`/`vs:sidebar` → `vscode:editor`/`vscode:sidebar`、surface `"workbench"` → `"vscode"`、包 `prac-host-vs-proxy`（`packages/host/vs-proxy`）→ `prac-host-vscode`（`packages/host/vscode`）、`workbenchRoot()` → `bundleRoot()`。

### 判据（都有输出）

```bash
grep -rn 'workbench' packages | grep -vE 'workbench\.parts|monaco-workbench|out-vscode-web|\.build/vscode|workbench\.web\.main\.internal|vscode-workbench-web-configuration'   # ⇒ 0
grep -rnE 'vs:|Vs[A-Z]|prac-vs-proxy|data-prac-vs' packages | grep -v vscode                                                                                                # ⇒ 0
grep -rn 'prac\|Prac\|PRAC\|DSH' vendor/vscode/overlay/bridge.ts vendor/vscode/overlay/embeddedWorkbench.ts vendor/vscode/overlay/embeddedWebMain.ts vendor/vscode/patches      # ⇒ 0
```

（`overlay/page.html` 仍叫 `prac-shell` / `__pracVscode`：它是 `prac-vscode` 自己的**独立查看页**，不写进 checkout。）

## 2026-09-15：wrapper lib 抽出（执行完成）

`vendor/vscode-embed`（`prac-vscode-embed`）——prac-free、DSH-free、**没有 build 脚本**、导出**源码**（TS，与 `prac-vscode` 同一形态，消费方构建期内联）：

| 入口 | 内容 |
| --- | --- |
| `.`（`src/host/index.ts`） | `resolveBundleRoot({ from, override })`、`resolveCodeServerSegment({ distRoot, override })`、`createAssetHandler({ root, mountPath })`、`createCodeServerProxy({ host, port })` |
| `./client`（`src/client/index.ts`） | `createVscodeEmbed({ route, productName, … })` → `{ boot({ workspacePath }), partHost(partId), commands(), host(), error(), page }`；并再导出 `prac-vscode` 的 embed 契约（唯一的家仍在 `overlay/bridge.ts`） |

prac 两侧随之变薄：`packages/host/vscode` = 路由 `/prac-vscode` + 端口 `3091` + 两个环境变量（`PRAC_VSCODE_ROOT` / `PRAC_CODE_SERVER_PATH`）+ DSH 路由注册；`packages/client/vscode-host` = 工作区解析 + view→part 映射 + `pracVscode` 服务。约 600 行机制搬进 lib。

**页面级状态收成一个家（为下一步准备）**：boot 守卫、boot 元素、命令面、失败原因、**part→元素表**全在 `globalThis.__vscodeEmbed`（`VscodeEmbedPage`）。理由不是洁癖：消费方各自的 client bundle 会**各自内联一份** lib，模块作用域状态会分裂。

**这一步的两个真发现**（都属于"契约的消费者"这一类）：

1. **DOM 上的 `PART_HOST_ATTR` 携带的是 part id，不是 view id**。契约与载荷的默认路径都按 part id 查 host，而旧的 client 半边写的是 view id。lib 改回契约值后闸门立刻红（`verify-layout` 23/24、`verify-views` 超时）——它们一直用 view id 选 host。改法：闸门里显式写 `PART_OF_VIEW` / `VIEW_OF_PART`（**DOM 说 part，frame 说 view**），不假设相等。
2. **路由处理器拿到的是完整 pathname**。旧代码在插件里 `slice(WORKBENCH_ROUTE.length)`，抽进 lib 时漏掉 ⇒ DSH 侧 `/prac-vscode/vs/…` 全 404，而**独立页 smoke 反而正常**（那条路不走路由）——只看 smoke 会假绿。机制侧因此有 `mountPath` 参数。

## 教训（跨步骤，都是硬证据）

1. **未解析的类型在 `skipLibCheck` 下是真空通过，不是检查通过**。手写 `declare module "react"` 让 `ReactNode` 退化成 `any`，于是 `slots.register` 的组件签名真空通过；换成真 `@types/react` 后立刻抓到 `partHost(view): () => unknown` 的类型错（TS2769）。
2. **`.d.ts` 里的 side-effect import 会被擦除，`.ts` 模块里的不会**。把 `import "@deepseek-ai/dsh-client-ui-*"` 从 `.d.ts` 搬进 `contract.ts` 后它们变成运行期导入，打包器把 5 个 DSH 包内联，`dist/client.js` 36 kB → 218 kB，loader 检查红、页面起不来。合并只需该 specifier 以**类型导入**出现在程序里。
3. **别在我们发布的类型里再导出 DSH 的类型**：dts 打包会把 DSH 声明内联进我们的 `.d.mts`，消费方于是有两份 `SlotMap`，我们的增强落在没人用的那份上 ⇒ key 类型塌成 `never`。
4. **`x satisfies T` 不是纯类型——表达式会求值**：`ctx.layout satisfies ILayout` 触发了 Cordis 的运行时检查（`cannot get property "layout" without inject`），整页失败。
5. **闸门也是契约的消费者**（三次实例）：surface id `"workbench"` 写死在 `verify-focus`；view id vs part id 写在 `verify-layout`/`verify-views`；route 前缀漏 strip 时 smoke 假绿。改名/改契约时要把"谁读了这个值"一起枚举。
6. **改名 + 包目录重命名会同时打穿 profile**：`~/.dsh/profiles/prac-dev/package.json` 里是绝对路径 link，目录一改就是死链（`pnpm install` 重链），且 host 半边路由变了必须重启 DSH（`patchReload: startup`）。

## 验收（最终，2026-09-15 实测）

九包 `vp run -r check` 全绿；五份产物 `check:client` 全部 `ok — loader(…)`；四闸门 **24/24 · 33/33 · 12/12 · 1/1**（`:3084`，重启后重跑）；独立页 `vscode:smoke`：**8/8** part 挂载、`editorContent: true`、`errorCount: 0`；staged 载荷与 `overlay/` 逐字节相同。

## 仍然开放

- **Step B（第二部分）**：值类跨包契约**已改名但仍是重复字面量**——view id `vscode:editor`/`vscode:sidebar` 仍是 **6 处**拼写（两个座位、`vscode-host` 的 `PART_OF_VIEW`、编排、以及注释），`/prac-vscode` 路由仍是 Node/浏览器**两处**。方案：座位在自己的 host 半边导出 view id 常量（消费方构建期内联）；路由常量由 host 包通过一个**无 Node 依赖的子路径导出**给 client 半边（直接 import 主入口会把 `node:http` 拖进浏览器 bundle）。
  - **这个方案里最大的空洞仍未填**：那个共享常量模块**放哪、依赖方向朝哪**（"浏览器侧边界包由 Node 侧 import" vs "独立的最小模块"）——决定 2 只定了"构建期内联"，没定落点。它是"契约写 6 遍 / 2 遍"的根因。
- **边界由哪些包构成**：本 note 前半写的是"两个 prac 包 + 一个上游本家"；2026-09-15 之后实际是 **`vendor/vscode` + `vendor/vscode-embed` + `packages/{host/vscode, client/vscode-host}`**（vendor 双子 + prac 两行）。以 umbrella §3 的图为准。
- **类型重复**（曾记"两个座位各自手写我们的面"）：**已闭合**——Step B 第一部分发布了 `dist/client.d.mts`，两个座位改成从 `prac-client-vscode-host/client` 导入 `PracVscodeFace`。
- **`node_modules` 里的 DSH 类型是 npm 精确 pin**，与 checkout 的一致性靠 `scripts/dsh-types.mjs --compare --checkout <path>`；机制正确的 checkout 覆盖开关（重定向解析而非文件路径）未做——只有真需要时才做。
- 若日后要动补丁载荷位置/拷贝归属，那时再谈。
