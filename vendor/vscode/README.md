# prac-vscode

prac **拥有**的 VS Code——以 **pin + patch + 构建配方**的形式，而**不是**拷贝源码。

- **上游**：`https://github.com/microsoft/vscode.git`（Code - OSS），tag `1.137.0`，构建时解析到的 commit `645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`。
- **仓库拥有**（进 git）：`package.json#prac.vscode`（pin）、`patches/`（对上游的**唯一**改动源）、`scripts/build.mjs`（可复现配方）、`overlay/`（构建期放进上游/产物树的文件）、`scripts/verify-*.mjs`（活体验证）。
- **仓库不拥有**（gitignored）：上游源码本身。它体积约 350MB，由构建在 `<repo>/.build/vscode` 里 `git clone --depth 1 --branch 1.137.0` 取得，之后只在 **pin 变化**时被 reset 回 pristine tag，再按名序应用补丁（已应用的跳过）。要手动回到 pristine 用 `vscode:clean`。

这与 DSH 的 `vendor/` 是同一意图（框架层**可审计、可打补丁、被钉住**，见 DSH `vendor/README.md`）下的**另一种形式**：

|                       | 做法                                       | 代价                                       |
| --------------------- | ------------------------------------------ | ------------------------------------------ |
| DSH `vendor/`         | **source-vendored**：源码拷进仓库          | 仓库体积大，但 `diff` 直接可读             |
| prac `vendor/vscode/` | **patch-vendored**：只拷 pin + 补丁 + 配方 | 需要一次构建才能得到源码；改动以补丁为单位 |

**不要把这个包描述成 source-vendored**——源码不在仓库里，这样说是不成立的。

### `overlay/` 是什么

**构建期被放进去的文件**都住在这里，目录名说明它的用途，而不是混进"本包源码"：

| 文件                           | 去处                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay/embedBridge.ts`       | `<checkout>/src/vs/workbench/browser/embedBridge.ts` —— 两侧编译的交互契约（**单一定义**）                                                                    |
| `overlay/extensionsGallery.ts` | `<checkout>/src/vs/workbench/browser/extensionsGallery.ts` —— 扩展市场的单一数据源（`embedBridge.ts` 从 `./extensionsGallery.js` 再导出，**必须一起 stage**） |
| `overlay/embeddedWorkbench.ts` | `<checkout>/src/vs/workbench/browser/embeddedWorkbench.ts` —— 组合载荷：以外部 host 为布局服务                                                                |
| `overlay/embeddedWebMain.ts`   | `<checkout>/src/vs/workbench/browser/embeddedWebMain.ts` —— 覆写 `createWorkbench` 的入口                                                                     |

（`scripts/page.html` **不在这里**：它不落盘，由 `vscode:serve` 就地服务，见改动日志 6。）

**命名规则**（两条，跟上游的做法一致；**overlay 里的名字 = stage 后的名字**，所以上表四行都是同名映射）：

1. **文件跟它定义的东西同名**——上游也是这么做的（`codeEditorWidget.ts` → `CodeEditorWidget`）。所以 `embedBridge.ts` 定义 `EMBED_BRIDGE` / `EmbedBridge` / `readEmbedBridge`，`extensionsGallery.ts` 定义 `EXTENSIONS_GALLERY`，`embeddedWorkbench.ts` 定义 `EmbeddedWorkbench`。
2. **替代或扩展上游某个文件时，镜像它的名字**——`embeddedWebMain.ts` 对 `web.main.ts`（它定义 `EmbeddedBrowserMain`，改的是上游 `BrowserMain` 的组合缝），`embeddedWorkbench.ts` 对 `workbench.ts`。这样它落在树里、紧挨着被替代的那个文件时读起来是自然的。

> 2026-09-16 之前 `embedBridge.ts` 在 overlay 里叫 `bridge.ts`（唯一"stage 后改名"的文件），`extensionsGallery.ts` 叫 `gallery.ts`（泛名，且与上游将来可能新增的同名文件有覆盖冲突）。改成现在这两个名字后，规则有了出处，表里也不再有例外。

包的入口直接指向契约，所以其它包**直接 import**，不必知道 staging 细节：

```ts
import { EMBED_BRIDGE } from "prac-vscode";
```

## 它不是 DSH 插件

本包没有 `main`、没有 `dsh` 字段、`exports` 只有 `./package.json`：它**不构成 loader 行**，也不注册任何 prac 内容槽。它构建出来的东西由别的包消费，各归其位：

| 职责                                                                  | 归属                                                                                                             |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 服务构建产物（同源路由 `/prac-vscode` + code server 的 HTTP/WS 代理） | **机制**在 `prac-vscode-embed`（`vendor/vscode-embed`）；**策略**在 `prac-host-vscode`（`packages/host/vscode`） |
| 在 DSH 页里启动 VS Code（每页一次）+ 目录（id 约定与挂载入口）        | **机制**在 `prac-vscode-embed/client`；**何时启动 + 目录怎么拼**在 `prac-client-vscode-host`                     |
| 把目录注册成 `prac.widget`                                           | `prac-client-ui-vscode-editor`（打开的文件） / `prac-client-ui-vscode-views`（视图注册表里的视图）               |
| 落位（谁放哪、注意力、快捷键）                                        | `prac-web-app`（bundle 的编排半边）                                                                              |

拆开的原因：两个消费者必须能**各自单独**使用，所以启动 VS Code 的机制不能属于任何一个消费者；而「谁服务产物」是 host 面的事，与「怎么改上游」是两件事。

## 仓库内的改动日志（local modifications）

保持这份清单**穷尽**：任何与上游的偏离都要列在这里。

1. **补丁集 `patches/0001-prac-vscode-composition.patch` 只装 delta** —— 对上游**已有文件**的**三处**改动（**两个**文件）：
   - 改 `src/vs/workbench/browser/web.factory.ts`：`create()` 用 `EmbeddedBrowserMain`（import 与调用，两处 hunk）。
   - 改 `src/vs/workbench/browser/web.main.ts`：`BrowserMain` 的 `configuration` 由 `private` 改 `protected`。覆写 `createWorkbench` 的组合者必须能把它交给自己的 workbench——construction options 里带着 `workspaceProvider` 这类"部件够不到"的事实，而 `createWorkbench` 那个 `IWorkbenchOptions` 参数是另一个小得多的袋子（`extraClasses`/`resetLayout`）。
   - 改 `src/vs/workbench/browser/web.main.ts`：`resolveWorkspace()` 里 `URI.revive()` 序列化的 `UriComponents`。不 revive 就过不了 `isSingleFolderWorkspaceIdentifier` 的 `URI.isUri` 守卫，表现为「工作区打开了但是空的」。
2. **我们自己的文件走 `overlay/`，由构建放置（不走补丁）**：
   - `overlay/embeddedWorkbench.ts`（790 行）：`EmbeddedWorkbench implements IWorkbenchLayoutService`，把每个 part 挂进 `[data-vscode-embed-part-host="<part id>"]` **外部 host**，`layout()` 按 host 尺寸驱动（zen / centered / floating / 多窗口暂 stub）；服务图恢复后把面（`mountPartInto` / `movePartInto`（part 是单实例，只能**搬**不能重建）、`openUntitled`、`openWorkspaceFolder`（页侧构造不出 `vscode.openFolder` 要求的 `URI` 实例，故由 hold 着 `URI` 的 workbench 侧代调，且**不带**窗口选项——`forceReuseWindow` 会走 embedder 那个只会导航的 `workspaceProvider.open()`））**交回 embedder**。
   - `overlay/embeddedWebMain.ts`（44 行）：`EmbeddedBrowserMain extends BrowserMain`，覆写 `createWorkbench`。
   - `overlay/embedBridge.ts`：桥接契约（下面是单独一段）。
   - 这四份（`embedBridge.ts` / `extensionsGallery.ts` / `embeddedWorkbench.ts` / `embeddedWebMain.ts`）由 `build.mjs` 的 `stageOverlay()` 拷进 checkout 的上游路径。`scripts/page.html` **不在其中**：它不落盘，由 `vscode:serve` 就地服务。
   - **为什么载荷不进补丁**：补丁应当是 _delta_。载荷是我们**自己的完整文件**（959 行，含契约），放进补丁会让"我们对上游做了什么"淹没在自己的代码里；作为真文件它还能被 review / grep / fmt（类型检查除外，见下）。
   - **载荷不带上游版权头**：它们不是上游代码，所以 `embeddedWorkbench.ts` / `embeddedWebMain.ts` 直接以自己的文档注释开头（`embedBridge.ts` / `extensionsGallery.ts` 本来就没有）。代价说清楚：若在 checkout 里跑**上游自己的** eslint，`header/header` 会对这两个文件报"缺版权头"——我们本来就不跑上游 lint（见下），而挂一个不属于自己的版权头是更糟的问题。产物不受影响：esbuild 会丢注释，web bundle 里只剩构建注入的那一条版权横幅（实测 1 处）。
   - **它不被我们的类型检查覆盖**：这两个文件按上游树的位置写相对导入（`../../base/common/…`），只有在上游 checkout 里才成立。`vendor/vscode/.eslintignore` 因此排除它们（`vp check` 的检查集），`tsconfig.json` 的 `include` 也只收 `overlay/embedBridge.ts`。要真正检查它们，得在 checkout 里跑上游自己的 tsc（分钟级，未做）。
3. **桥接契约由构建放置，不进补丁**：`vendor/vscode/overlay/embedBridge.ts` 是 prac ↔ workbench 交互面的**单一定义**（options 字段名 `vscodeEmbed`、`deferParts`、面的类型、`readEmbedBridge()` 校验器）。`build.mjs` 把它拷成 `<checkout>/src/vs/workbench/browser/embedBridge.ts`，两侧编译同一份文件（client 半边直接 `import ... from "prac-vscode"`，拿到的是同一份原件），所以字段名只拼写一次。
   - 交互面**不再走 window 全局**（原 `__pracDeferVsParts` 入、`__vscodeEmbed` 出已删除）：prac 在 `create()` 的 construction options 里交进一个 bridge 对象，VS Code 侧用 `IBrowserWorkbenchEnvironmentService.options` 读它（补丁本来就持有这个服务），并把面经 `bridge.publish(face)` 交回。**无 bridge（独立页）= 走默认路径**：VS Code 自己把 part 挂进带 part id 的文档 host。
   - 这份契约是**唯一被 stage 而不是被 patch 的文件**：补丁条目只能装一侧的拼写，那样字段名就又写两遍了。
4. **`package.json`**：脱离 DSH 插件形状（删 `main` / `dsh` / `exports` 主入口 / 原 client 半边），scripts 收敛为构建 + 验证。
5. **构建配方 `scripts/build.mjs` 的偏离**（相对上游 `npm install && gulp` 的常规路径）：
   - 根依赖 `npm install --ignore-scripts`：node-gyp native、playwright 浏览器下载、copilot 扩展 postinstall 这些消费环境跑不通的步骤对 web bundle **都不需要**，跳过它们还让构建只写仓库内（缓存重定向到 `.build/vscode/cache`）。`build/` 子包（自带 lockfile）单独装，因为 esbuild 需要它的 postinstall 校验平台二进制。
   - 补 `codicon.ttf`：web bundle 引用它，而它正常由上游 `copy-codicons` 任务产出（我们跳过脚本）。
   - `stageOverlay()`：见第 2 条（在 drift 检查与 apply 之后执行）。
   - **构建不 reset checkout**（2026-09-16 起）：pin 没变就直接在现有树上继续，补丁逐条用 `git apply --check -R` 判定，已应用就跳过（正向 `--check` 在已应用的树上必然失败，反向能过即「已在树里」）。第一次构建之外的构建因此不会再走一遍 reset + apply。
   - **drift 警告（只报告，不修正）**：构建开始前跑一次 `git status --porcelain`，把不属于本配方写的路径（补丁目标、盖章的 `product.json`、`overlay/` 四份的落点）逐条打出来，并提示 `vscode:clean`。checkout 是构建工作树、不是第二份真源，别人的改动会静默进 bundle，所以值得一行警告；但**自动改回会毁掉正在被 debug 的树**，所以只是警告。
   - **独立查看页不落盘**（2026-09-16 起）：`vscode:serve` 的 `/` 映到 `scripts/page.html`、`/out/*` 映到 checkout 的 bundle；旧的 `stage/` 目录与那个指向 checkout 的绝对符号链接已删。
   - `stampServerCommit()`：把 checkout 的 commit 写进**盖章目标**（`.` 与 `out-vscode-reh` 两处；扁平 server 产物自己那份 `product.json` 不存在）。客户端与服务端各自读一份 `product.json` 来算 `getServerProductSegment()`，不盖章时服务端算 `oss-dev`、客户端要 `/oss-<commit>`，表现为「编辑器打不开文件」而不是路径不匹配。
6. **`scripts/page.html`** 是**测试件**（产品里零引用：`packages/` 与 `vendor/vscode-embed/` 都不碰它）。它 `create(document.body, ...)` + 给每个 part 一个外部 host，且**不传 bridge**。

   **它守的不是"上游 pristine 路径"**——补丁把 `create()` 换成了 `EmbeddedBrowserMain`，所以两条路都走我们的 `EmbeddedWorkbench`；它守的是**我们 composition 的"无 embedder 策略"分支**：没有 bridge 时，8 个 part 是否仍然挂进页面自己声明的 `[data-vscode-embed-part-host]` host 并画出像素。`vscode:smoke` 盯的就是它，`vscode:serve` 只是给人肉查看这条分支用。若哪天砍掉这条分支（"没有 embedder 时的回退形态"），这个夹具与那条 smoke 应当一起删。

## 用法

```bash
# 构建（首次 clone 上游 + 装依赖 + 转译 + 打包，约数分钟）
vp run --filter prac-vscode vscode:build

# 起本地静态服务独立查看（默认 http://127.0.0.1:5199/）
vp run --filter prac-vscode vscode:serve

# 无头冒烟：断言 workbench 真的渲染出来（需要上面的服务在跑）
vp run --filter prac-vscode vscode:smoke

# 清构建：checkout 回到 pin + 删 out-*（保留 clone 与 node_modules，下次只重构）
vp run --filter prac-vscode vscode:clean

# 全清：连 clone 与 node_modules 一起删（下次构建从零）
vp run --filter prac-vscode vscode:clean-all
```

`node scripts/build.mjs [--force] [--skip-install] [--skip-build]`：`--force` 清空工作目录从零重建；`--skip-install` 复用已有依赖；`--skip-build` 只确保 checkout/install。

`vscode:build` 是**重的上游构建**，故意不叫 `build`，这样 `vp run -r build` 不会触发它。

### 目录规范（按生命周期分，不按来源分）

**构建期与一次性的东西在仓库里，运行期状态在仓库外**（James 2026-09-17：遵循 XDG）。

```
.build/                     可整份删 —— 里面只有能重新造出来的东西
  vscode/       构建期：**就是那份 Code - OSS checkout 本身**（PRAC_VSCODE_DIR 可覆盖）
                `vscode:clean` 让它回到 pin 并删产物（保留 clone 与 node_modules），
                `vscode:clean-all` 整份删掉、下次构建从零
                依赖与产物都在里面，因为上游的构建就是这样工作的：
    node_modules/   根依赖（npm install --ignore-scripts，~1.5G）
    build/          构建工具链自己的依赖
    src/vs/workbench/browser/{embedBridge,extensionsGallery,embeddedWorkbench,embeddedWebMain}.ts
                    ← 构建 stage 进去的我们的文件（与 overlay 里的原件逐字节相同）
    out-build/      转译产物（打包器的输入）
    out-vscode-web/ 真正被服务的东西：vs/… + nls.messages.js
    out-vscode-reh/ code server distro（扁平产物；product.json 已盖章）
    # 构建只出这两个目标——prac 用 code-server 形态（UI 在浏览器、扩展跑服务端
    # Node 扩展宿主，见 docs/architecture.md §5.2）；desktop / server-web 不构建。
  scratch/      一次性产物：随便删
    shots/  notes-backup/
```

运行期状态**不在仓库里**——它在 XDG 目录下，按数据的性质分（`$XDG_*_HOME` 未设时用规范里的默认值，macOS 上同样如此，所以三平台一套话）：

| 角色                                                                                                                    | 落在哪                                                            | 默认（相对 `$HOME`）                       | 谁来定                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| **装好的扩展**（第三方包本体，可重装）                                                                                  | `--extensions-dir` → `$XDG_DATA_HOME/prac/code-server/extensions` | `.local/share/prac/code-server/extensions` | 启动命令；闸门用 `EXTENSIONS_DIR` 覆盖 |
| **服务端状态**（`data/data/User/{workspaceStorage,globalStorage,History}`、`logs/`、`Machine/`、`CachedProfilesData/`） | `--server-data-dir` → `$XDG_STATE_HOME/prac/code-server`          | `.local/state/prac/code-server`            | 启动命令                               |
| **用户数据目录**（实测为空；留着是为了永不回退到 `~/.vscode-server-oss`）                                               | `--user-data-dir` → `$XDG_CONFIG_HOME/prac/code-server`           | `.config/prac/code-server`                 | 启动命令                               |
| **缓存**                                                                                                                | 不传 knob，用系统默认                                             | macOS `~/Library/Caches`                   | 不用管                                 |

- **为什么不在 `.build/run/`**：判据是「删掉它要付什么代价」。`.build/vscode` 是派生的、`scratch` 是一次性的，而扩展与 `workspaceStorage`/`globalStorage` 删了就没了（重装扩展、丢 workspace 状态）。把它们放在一个名字叫 build、且文档写着"可整份删"的根下，等于让那句话只对一半内容成立——`rm -rf .build` 是这个仓库里很自然的手势。XDG 的分类轴（config / data / state / cache）恰好就是这条判据。
- **为什么是这三个变量**：扩展是**装好的文件**（data，类比 `/usr/share`）；`workspaceStorage`/`globalStorage`/logs 是**重启后要留、但不是数据的状态**（state，类比 `/var/lib`）；用户数据目录是**配置**——VS Code 自己在 Linux 上就是这么放的（`$XDG_CONFIG_HOME/Code`）。
- **与主干一致**：DSH 的运行期状态也在家目录（`~/.dsh`，45M），不在任何 checkout 里；prac 的机器级缓存此前已经按同一条理由推出了仓库（见下）。
- **`--user-data-dir` 实测是空的**（2026-09-17，`find` 过一遍）：服务端把用户状态写进 `--server-data-dir`。仍然传它，是为了任何一条上游路径都不至于回退到 `~/.vscode-server-oss`。

**没有卫星目录**：独立查看页不落盘（`vscode:serve` 直接把 `/` 映到 `scripts/page.html`、`/out/*` 映到 checkout 里的 bundle），所以 checkout 之外只剩 XDG 下的运行期状态。

**工具缓存不在仓库里，构建的缓存也不在**——它们是机器级的，写进仓库配置无法共享（James 2026-09-16 裁决）：

| 缓存                  | 位置                                                | 谁管                                        |
| --------------------- | --------------------------------------------------- | ------------------------------------------- |
| pnpm 的 store         | `/Volumes/Dev/.pnpm-store`                          | 环境变量 `pnpm_config_store_dir`（见下）    |
| npm 的 cache          | `~/.npm`（默认）                                    | 不用管：构建**不再覆盖** `npm_config_cache` |
| node-gyp / playwright | `~/Library/Caches/{node-gyp,ms-playwright}`（默认） | 不用管                                      |
| corepack 的包管理器   | `~/.cache/node/corepack`（默认）                    | 不用管                                      |
| XDG 缓存              | 默认                                                | 不用管                                      |

**一个刻意的例外：pnpm 的 store 不在仓库里**，在 `/Volumes/Dev/.pnpm-store`，由**环境变量** `pnpm_config_store_dir` 指定。

- **为什么不写进仓库配置**：这是**机器/卷相关**的路径；写进 `pnpm-workspace.yaml` 等于每个仓库各抄一遍，反而不能共享。
- **为什么不用系统缓存目录**：`~`（`/System/Volumes/Data`）与项目（`/Volumes/Dev`）是**两个卷**，而 pnpm 靠硬链接装包；store 放到 `~/Library/pnpm/store` 会让每次安装退化成**复制**（node_modules 与 store 各存一份）。卷根那份 store 与同一卷上的其他仓库（含 DSH checkout）共享。
- **怎么装依赖**：用 **`vp install`**（不直接调 `pnpm`）。`vp` 底下就是 pnpm，所以上面那个环境变量照样管用。**仓库根不需要 `.npmrc`**：构建不再覆盖 `npm_config_cache` / `XDG_CACHE_HOME` 等，全部用系统默认位置（旧行为是把它们改道到 `.build/vscode/cache/`，已于 2026-09-16 删除）。
- **坑**：pnpm 12 起环境变量前缀是 **`pnpm_config_`**（`npm_config_store_dir` 被忽略），且 `.npmrc` 里的 `store-dir` 也不再生效——两者我都实测过。判断当前用的是哪份 store 看 `node_modules/.modules.yaml` 的 `storeDir`。

三条规则：

1. **谁写哪里**：构建脚本只写 `.build/vscode/`；开发工具（截图、备份）只写 `.build/scratch/`；**服务写 XDG 目录，不写仓库**；**工具缓存写各自的默认位置，也不进仓库**。
2. **构建期与运行期不互相引用**：XDG 里不放构建产物，`.build/` 里不放运行状态。
3. **脚本从环境变量派生路径**，不各自拼：`PRAC_VSCODE_DIR`（默认 `.build/vscode`）；服务路径从 `XDG_DATA_HOME` / `XDG_STATE_HOME` / `XDG_CONFIG_HOME` 派生（未设时用规范默认值），需要指到别处就设那几个变量，闸门要单个覆盖用 `EXTENSIONS_DIR`。仓库根只放源码。

## 扩展基座（`--target server`）

除 web bundle 外，构建还产出 **标准 `server` 目标**（`out-vscode-reh/`），浏览器连的就是它（WebSocket management + 扩展宿主），也是"哪些扩展算可安装"的判据来源。两半与协议的细节见 [`docs/vscode.md`](../../docs/vscode.md)。

- **产物是扁平的**：`out-vscode-reh/` 直接放 `server-main.js` 等（没有 `product.json`/`package.json`/`out/`），运行时按 `<checkout>` 解析 `node_modules` 与 `product.json`。
- **跑法**：DSH rig 里这一步由主干自己做（`prac-host-vscode` spawn 它：端口取空闲、不带 `--folder`、随插件 dispose 收掉）；下面这条是**手动起一份**用于单独调试的用法（cwd = checkout，状态目录按上面的 XDG 表派生）：
  ```bash
  cd .build/vscode
  D=${XDG_DATA_HOME:-$HOME/.local/share}; S=${XDG_STATE_HOME:-$HOME/.local/state}
  C=${XDG_CONFIG_HOME:-$HOME/.config}
  node out-vscode-reh/server-main.js --port 3091 --host 127.0.0.1 --without-connection-token \
    --server-data-dir $S/prac/code-server --extensions-dir $D/prac/code-server/extensions \
    --user-data-dir $C/prac/code-server <folder>
  ```
- **`product.json` 要盖章的是 checkout 根那份**（扁平产物自己那份不存在），否则服务端算 `oss-dev` 而客户端按 build 注入的 commit 要 `/oss-<commit>`。`build.mjs` 的盖章目标是 `.` 与 `out-vscode-reh` 两处（`.build/vscode/README.md` 的 `stampServerCommit()`）。
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

数目是**决定 21 删减后**的（机制断言搬进了各包的 `*.spec.ts`，用 `vp test` 跑）；vendor 门只留真页面能证明的事实。

**无 bridge 分支另有一条**：`vscode:smoke`（对着 `scripts/page.html`，默认 `:5199`，需 `vscode:serve` 在跑）断言 8 个 part 全部挂载且编辑器有内容、`errorCount: 0`——守的是“没有 embedder 策略时我们的 composition 仍能独立起来”。

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
- 构建**两个目标**：`out-vscode-web`（target `web`）与 `out-vscode-reh`（target `server`）；desktop 与 server-web 不构建（`docs/architecture.md` §5.2）。
- **构建会写仓库之外**：缓存（npm / node-gyp / playwright）用系统默认位置，即 `~/.npm`、`~/Library/Caches/node-gyp` 等——在受限沙箱里跑需要提权。2026-09-16 之前那条"缓存全在仓库内、无需提权"是旧行为。
- 上游 `postinstall` 里有些步骤在消费环境本就跑不通；本包不依赖它们。
