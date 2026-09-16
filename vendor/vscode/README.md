# prac-vscode

prac **拥有**的 VS Code——以 **pin + patch + 构建配方**的形式，而**不是**拷贝源码。

- **上游**：`https://github.com/microsoft/vscode.git`（Code - OSS），tag `1.137.0`，构建时解析到的 commit `645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`。
- **仓库拥有**（进 git）：`package.json#prac.vscode`（pin）、`patches/`（对上游的**唯一**改动源）、`scripts/build.mjs`（可复现配方）、`overlay/`（构建期放进上游/产物树的文件）、`scripts/verify-*.mjs`（活体验证）。
- **仓库不拥有**（gitignored）：上游源码本身。它体积约 350MB，由构建在 `<repo>/.build/vscode/upstream` 里 `git clone --depth 1 --branch 1.137.0` 取得，每次构建前被 **reset 回 pristine tag**，再按名序应用补丁。

这与 DSH 的 `vendor/` 是同一意图（框架层**可审计、可打补丁、被钉住**，见 DSH `vendor/README.md`）下的**另一种形式**：

|                       | 做法                                       | 代价                                       |
| --------------------- | ------------------------------------------ | ------------------------------------------ |
| DSH `vendor/`         | **source-vendored**：源码拷进仓库          | 仓库体积大，但 `diff` 直接可读             |
| prac `vendor/vscode/` | **patch-vendored**：只拷 pin + 补丁 + 配方 | 需要一次构建才能得到源码；改动以补丁为单位 |

**不要把这个包描述成 source-vendored**——源码不在仓库里，这样说是不成立的。

### `overlay/` 是什么

**构建期被放进去的文件**都住在这里，目录名说明它的用途，而不是混进"本包源码"：

| 文件                           | 去处                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `overlay/bridge.ts`            | `<checkout>/src/vs/workbench/browser/embedBridge.ts` —— 两侧编译的交互契约（**单一定义**）     |
| `overlay/embeddedWorkbench.ts` | `<checkout>/src/vs/workbench/browser/embeddedWorkbench.ts` —— 组合载荷：以外部 host 为布局服务 |
| `overlay/embeddedWebMain.ts`   | `<checkout>/src/vs/workbench/browser/embeddedWebMain.ts` —— 覆写 `createWorkbench` 的入口      |
| `overlay/page.html`            | `<work>/web/index.html` —— 独立查看页的壳                                                      |

包的入口直接指向契约，所以其它包**直接 import**，不必知道 staging 细节：

```ts
import { EMBED_BRIDGE } from "prac-vscode";
```

## 它不是 DSH 插件

本包没有 `main`、没有 `dsh` 字段、`exports` 只有 `./package.json`：它**不构成 loader 行**，也不注册任何座位。它构建出来的东西由别的包消费，各归其位：

| 职责                                                                  | 归属                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 服务构建产物（同源路由 `/prac-vscode` + code server 的 HTTP/WS 代理） | **机制**在 `prac-vscode-embed`（`vendor/vscode-embed`）；**策略**在 `prac-host-vscode`（`packages/host/vscode`） |
| 在 DSH 页里启动 VS Code（每页一次）+ part host 工厂                   | **机制**在 `prac-vscode-embed/client`；**何时启动 + view↔part 映射**在 `prac-client-vscode-host`                 |
| 座位 `vscode:editor` / `vscode:sidebar`                               | `prac-client-ui-vscode-editor` / `prac-client-ui-vscode-explorer`                                                |
| 落位（谁放哪、注意力、快捷键）                                        | `prac-web-app`（bundle 的编排半边）                                                                              |

拆开的原因：两个座位必须能**各自单独**使用，所以启动 VS Code 的机制不能属于任何一个座位（seat）；而「谁服务产物」是 host 面的事，与「怎么改上游」是两件事。

## 仓库内的改动日志（local modifications）

保持这份清单**穷尽**：任何与上游的偏离都要列在这里。

1. **补丁集 `patches/0001-prac-vscode-composition.patch` 只装 delta** —— 对上游**已有文件**的**三处**改动（**两个**文件）：
   - 改 `src/vs/workbench/browser/web.factory.ts`：`create()` 用 `EmbeddedBrowserMain`（import 与调用，两处 hunk）。
   - 改 `src/vs/workbench/browser/web.main.ts`：`BrowserMain` 的 `configuration` 由 `private` 改 `protected`。覆写 `createWorkbench` 的组合者必须能把它交给自己的 workbench——construction options 里带着 `workspaceProvider` 这类"部件够不到"的事实，而 `createWorkbench` 那个 `IWorkbenchOptions` 参数是另一个小得多的袋子（`extraClasses`/`resetLayout`）。
   - 改 `src/vs/workbench/browser/web.main.ts`：`resolveWorkspace()` 里 `URI.revive()` 序列化的 `UriComponents`。不 revive 就过不了 `isSingleFolderWorkspaceIdentifier` 的 `URI.isUri` 守卫，表现为「工作区打开了但是空的」。
2. **我们自己的文件走 `overlay/`，由构建放置（不走补丁）**：
   - `overlay/embeddedWorkbench.ts`（790 行）：`EmbeddedWorkbench implements IWorkbenchLayoutService`，把每个 part 挂进 `[data-vscode-embed-part-host="<part id>"]` **外部 host**，`layout()` 按 host 尺寸驱动（zen / centered / floating / 多窗口暂 stub）；服务图恢复后把面（`mountPartInto` / `movePartInto`（part 是单实例，只能**搬**不能重建）、`openUntitled`、`openWorkspaceFolder`（页侧构造不出 `vscode.openFolder` 要求的 `URI` 实例，故由 hold 着 `URI` 的 workbench 侧代调，且**不带**窗口选项——`forceReuseWindow` 会走 embedder 那个只会导航的 `workspaceProvider.open()`））**交回 embedder**。
   - `overlay/embeddedWebMain.ts`（44 行）：`EmbeddedBrowserMain extends BrowserMain`，覆写 `createWorkbench`。
   - `overlay/bridge.ts`：桥接契约（下面是单独一段）。
   - 这三份由 `build.mjs` 的 `stageOverlay()` 拷进 checkout 的上游路径；`overlay/page.html` 拷进产物树。
   - **为什么载荷不进补丁**：补丁应当是 _delta_。载荷是我们**自己的完整文件**（959 行，含契约），放进补丁会让"我们对上游做了什么"淹没在自己的代码里；作为真文件它还能被 review / grep / fmt（类型检查除外，见下）。
   - **它不被我们的类型检查覆盖**：这两个文件按上游树的位置写相对导入（`../../base/common/…`），只有在上游 checkout 里才成立。`vendor/vscode/.eslintignore` 因此排除它们（`vp check` 的检查集），`tsconfig.json` 的 `include` 也只收 `overlay/bridge.ts`。要真正检查它们，得在 checkout 里跑上游自己的 tsc（分钟级，未做）。
3. **桥接契约由构建放置，不进补丁**：`vendor/vscode/overlay/bridge.ts` 是 prac ↔ workbench 交互面的**单一定义**（options 字段名 `vscodeEmbed`、`deferParts`、面的类型、`readEmbedBridge()` 校验器）。`build.mjs` 把它拷成 `<checkout>/src/vs/workbench/browser/embedBridge.ts`，两侧编译同一份文件（client 半边直接 `import ... from "prac-vscode"`，拿到的是同一份原件），所以字段名只拼写一次。
   - 交互面**不再走 window 全局**（原 `__pracDeferVsParts` 入、`__vscodeEmbed` 出已删除）：prac 在 `create()` 的 construction options 里交进一个 bridge 对象，VS Code 侧用 `IBrowserWorkbenchEnvironmentService.options` 读它（补丁本来就持有这个服务），并把面经 `bridge.publish(face)` 交回。**无 bridge（独立页）= 走默认路径**：VS Code 自己把 part 挂进带 part id 的文档 host。
   - 这份契约是**唯一被 stage 而不是被 patch 的文件**：补丁条目只能装一侧的拼写，那样字段名就又写两遍了。`git clean -fd` 每次都会删掉它，所以每次构建都重新拷。
4. **`package.json`**：脱离 DSH 插件形状（删 `main` / `dsh` / `exports` 主入口 / 原 client 半边），scripts 收敛为构建 + 验证。
5. **构建配方 `scripts/build.mjs` 的偏离**（相对上游 `npm install && gulp` 的常规路径）：
   - 根依赖 `npm install --ignore-scripts`：node-gyp native、playwright 浏览器下载、copilot 扩展 postinstall 这些消费环境跑不通的步骤对 web bundle **都不需要**，跳过它们还让构建只写仓库内（缓存重定向到 `.build/vscode/cache`）。`build/` 子包（自带 lockfile）单独装，因为 esbuild 需要它的 postinstall 校验平台二进制。
   - 补 `codicon.ttf`：web bundle 引用它，而它正常由上游 `copy-codicons` 任务产出（我们跳过脚本）。
   - `stageOverlay()`：见第 2 条（在 reset/apply 之后执行）。
   - stage `<work>/web` = 我们的 `index.html` + `out/` 符号链接 → bundle（**独立查看**用；DSH 页不读它）。
   - `stampServerCommit()`：把 checkout 的 commit 写进 `out-server-web/product.json`。客户端与服务端各自读一份 `product.json` 来算 `getServerProductSegment()`，不盖章时服务端算 `oss-dev`、客户端要 `/oss-<commit>`，表现为「编辑器打不开文件」而不是路径不匹配。
6. **`overlay/page.html`** 是 prac 的壳：`create(document.body, ...)` + 每个 part 一个外部 host（**不传 bridge**，所以它走的就是"workbench 自己挂 part"的默认路径；`vscode:smoke` 盯的就是这条路）。

## 用法

```bash
# 构建（首次 clone 上游 + 装依赖 + 转译 + 打包，约数分钟）
pnpm --filter prac-vscode vscode:build

# 起本地静态服务独立查看（默认 http://127.0.0.1:5199/）
pnpm --filter prac-vscode vscode:serve

# 无头冒烟：断言 workbench 真的渲染出来（需要上面的服务在跑）
pnpm --filter prac-vscode vscode:smoke

# 清掉构建目录（上游 checkout、缓存、产物）
pnpm --filter prac-vscode vscode:clean
```

`node scripts/build.mjs [--force] [--skip-install] [--skip-build]`：`--force` 清空工作目录从零重建；`--skip-install` 复用已有依赖；`--skip-build` 只确保 checkout/install。

`vscode:build` 是**重的上游构建**，故意不叫 `build`，这样 `vp run -r build` 不会触发它。

### 产物布局

```
.build/vscode/                       # gitignored；PRAC_VSCODE_DIR 可覆盖
  upstream/                             # Code - OSS checkout（pin tag，构建前 reset）
    src/vs/workbench/browser/embedBridge.ts   # ← 构建 stage 的桥接契约（不是补丁，见改动日志 2）
    out-vscode-web/                     # ← 真正被服务的东西：vs/… + nls.messages.js
    out-server-web/                     # code server distro（product.json 已盖章）
  web/                                  # 独立查看用的页面：index.html + out/ -> upstream/out-vscode-web
  cache/                                # npm / node-gyp / xdg / ms-playwright 缓存
```

## 扩展基座（`--target server`）

除 web bundle 外，构建还产出 **标准 `server` 目标**（`out-server/`），浏览器连的就是它（WebSocket management + 扩展宿主），也是"哪些扩展算可安装"的判据来源。

- **产物是扁平的**：`out-server/` 直接放 `server-main.js` 等（没有 `product.json`/`package.json`/`out/`），运行时按 `<checkout>` 解析 `node_modules` 与 `product.json`。
- **跑法**（cwd = checkout）：
  ```bash
  cd .build/vscode/upstream
  node out-server/server-main.js --port 3091 --host 127.0.0.1 --without-connection-token \
    --server-data-dir …/server/data --extensions-dir …/server/extensions --user-data-dir …/server/user <folder>
  ```
- **`product.json` 要盖章的是 checkout 根那份**（扁平产物自己那份不存在），否则服务端算 `oss-dev` 而客户端按 build 注入的 commit 要 `/oss-<commit>`。`build.mjs` 现在给 `.` / `out-server` / `out-server-web` 都盖。
- **装扩展**：`server-cli --install-extension` 被守卫挡住（`server.cli.ts:94` 要求 `VSCODE_IPC_HOOK_CLI` 或 `VSCODE_CLIENT_COMMAND`，即"在 VS Code 终端里"）。手工装即可：VSIX 是 zip，解包后把 `extension/` 移成 `<extensions-dir>/<publisher>.<name>-<version>/`，删掉 `extensions.json`，重启服务端。
- **已知边界**：扩展贡献的 **tree view** 能挂上、有标题、有像素，但 body 是 "no data provider registered"——树数据要等视图基础设施/容器把它认成"可见的视图"，裸 pane 还不够（下一步）。

## 验证（活体闸门）

这些闸门都打真实浏览器、看 **DOM 与像素**（不是看代码），需要 DSH 页在跑。它们也正是**交互面走 bridge** 的回归测试：bridge 若失效，workbench 会退回"自己挂 part"的默认路径、把 part 挂进不可见的 boot 容器，于是它们全红。

```bash
URL='http://127.0.0.1:3084/?token=…' node scripts/verify-layout.mjs   # 14 项
URL='…' node scripts/verify-views.mjs                                 # 28 项
URL='…' node scripts/verify-focus.mjs                                 # 9 项
URL='…' node scripts/verify-regions.mjs                               # 6 项（frame 托管的是 view：无 part、view 有尺寸、退役的 editor part 只在屏外）
URL='…' node scripts/verify-view.mjs                                    # 7 项（单 view 宿主：无 part、有像素、可释放重建）
URL='…' node scripts/verify-file.mjs                                    # 33 项（单文件编辑面：真实文本、有像素、一文件一面、可释放重建；app 打开文件通过事件报到；stage 的 tab 条：一条文件也有、两条最新 active、点 tab 换 view；reload 后文件 view 跟着消失；`editors` 能力：不挂 view 也回答、activate/dirty/close；tab 脏点、点 tab 与 app 的 active editor 对上；`diagnostics` 契约：形状/分页/settled 等 quiet）
URL='…' node scripts/verify-extension.mjs                               # 5 项（需已装扩展；没装则明确 SKIP。`VIEW=none` 用于没有 view 的扩展：改用它产生的诊断来证明激活）
```

数目是**决定 21 删减后**的（机制断言搬进了各包的 `*.spec.ts`，用 `pnpm test` 跑）；vendor 门只留真页面能证明的事实。

**独立页（无 bridge 的默认路径）另有一条**：`vscode:serve`（默认 `:5199`）跑着时 `vscode:smoke` 断言 8 个 part 全部挂载且编辑器有内容，`errorCount: 0`。

- `verify-layout`：区域树分栏、sash 拖拽（两个轴）、收起/展开恢复缓存尺寸，且**当前文件 view** 全程在画并落在编排要求的位置（`stage`）。
- `verify-views`：调出面（recall surface）按快捷键打开、列出实时 view 目录、隐藏/调出/移区/分栏都在像素上生效。
- `verify-focus`：注意力把**当前文件 view** 在轨道与中央之间搬移且仍在上屏（内容按渲染出的行判定）；含不变量「一个文件恰好一个编辑面」。打开文件会移动注意力，所以条与布局始终一致。
- `verify-regions`：**frame 里没有 part**（决定 17 之后 prac 组合的是 view），被退役的 editor part 只以**离屏**形式存在（服务图需要它），view host 有尺寸且它自己的 pane 不超出宽度。
- 活体门里只有**需要 VS Code 侧**的那些住在这里（part host / embed face / 扩展 / 编辑器像素）；**prac 自己机制的闸门放 prac 的 `tests/gates/`**（如堆叠）。
- `verify-view`：**单个 view** 被造成自带 pane 挂进 prac 的 region（页面里没有 sidebar part），并且跨 region 搬移时释放后重建仍然上屏。
- `verify-file`：**一个文件的编辑面**（决定 17 的单位）＋ **stage 的 tab 条**（借 VS Code 的 `showTabs` 默认：一个文件也显示）——工作台自己的模型渲染出该文件的真实文本、有像素、同一文件重复挂载是同一实例换宿主、释放后能再挂载。期望值由门自己从磁盘读同一个文件算出：**app 的工作区是 DSH 的活动工作区**，不是本仓。
- `verify-extension`：装好的第三方扩展**激活**（它的 view 描述符只有激活后才存在），且 `mountViewInto` 能把它的 view 渲染进 prac；`VIEW=…` 换视图。

闸门输出的 `errorCount` 含**已知噪音**：extension host 加载 `@vscode/spdlog` / `@vscode/native-watchdog` 的 native binding 失败（我们不构建 native 产物），不影响 workbench 上屏；判定看 `checks` 全 `true` 与结尾的 `OK:` 行。

## 同步（升级上游）

1. 改 `package.json#prac.vscode.tag`。
2. 在新 tag 的 pristine checkout 上确认 `patches/*.patch`（只有 delta）仍能干净应用；有冲突就改上游源码、再 `git diff` 生成（**不要手改补丁文本**）。
   - 补丁里**只应出现对上游已有文件的改动**；我们自己的文件在 `overlay/`，由 `stageOverlay()` 放置，不进补丁。
3. 确认 overlay 的落点仍存在：上游若挪动了 `src/vs/workbench/browser/`，`build.mjs` 的 `OVERLAY` 表与载荷里的 `./embedBridge.js` 相对引用要跟着改。
4. `node scripts/build.mjs --force`。
5. 跑上面四条闸门 + 独立页的 `vscode:smoke`。
6. 更新本文件顶部的 commit 与清单。

## 已知边界

- 构建重：clone（~350MB）+ 依赖 + 转译 + 打包。
- 只构建 **web** 目标；desktop / server 目标未覆盖（server distro 只作为 code server 使用）。
- 构建只写仓库内（缓存全在 `.build/vscode/cache`），无需提权。
- 上游 `postinstall` 里有些步骤在消费环境本就跑不通；本包不依赖它们。
