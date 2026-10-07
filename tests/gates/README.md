# prac 自己的活体门

断言 **prac 机制**（frame、目录、放置、持久化）的门住在这里；需要 VS Code 侧的集成门在 `vendor/vscode/scripts/`。
这条归属规则的理由很实在：门最初借用了上游 checkout 的 Playwright，于是 prac 自己的验证反过来依赖 `vscode:build` 跑过——依赖倒置。

**谁该住在这里（决定 21，2026-09-15）**：这层**只放真页面才能证明的事实**——产物过了真 loader、VS Code 部件真的挂进/搬出 prac 区域并画出像素、扩展真的激活。**机制断言（纯函数/纯算术）住进各包的 `*.spec.ts`，用 `vp test` 跑**（vite-plus 内置 vitest，零新依赖）；要新增一个活体断言，先写清"单测为什么证明不了它"。理由是实测：活体断言大半是"在浏览器里给纯函数做算术题"——`sash 上界` 那类 bug 单测 5 行就能抓，而当时的门 23 项全绿。**代价**：单测看不见"模型对了、渲染器没跟上"的假绿 ⇒ 每个能力在活体层**至少留一条渲染断言**。

```bash
# 需要一页活着的 DSH（profile prac-dev）；URL 带 token，和其它门一样
URL='http://127.0.0.1:3084/?token=…' vp run verify:stack        # 堆叠：单视图裸渲染、两个叠放、折叠
URL='http://127.0.0.1:3084/?token=…' vp run verify:bottom       # 底栏：空则不在、填了上屏、折叠还回空间
URL='http://127.0.0.1:3084/?token=…' vp run verify:containers   # 容器：条上可切换、一次只显示一个、视图都上屏
URL='http://127.0.0.1:3084/?token=…' vp run verify:persistence  # 持久化：改尺寸/堆叠/折叠/底栏，reload 后复原
URL='http://127.0.0.1:3084/?token=…' vp run verify:split        # 分栏：上下左右（可嵌套）、旧面板留视图、竖 sash 可拖、形状持久
```

`verify:containers` 守的是「一次只显示一个容器」这条**渲染**事实：模型里 `left` 挂着四个子区域，DOM 里只准有一个。这正是单测证明不了的那半——单测能证明 `placeCatalogue` 造出了对的子区域，证明不了渲染器只画了一个。伪造过一次：把 `renderRegion` 的选择分支改成渲染全部子区域，该门只在 `one container at a time` 上变红、其余仍绿。

`verify:containers` 与 `verify:persistence` 都先从**出厂形状**起（清 key + reload）：门共用一台 rig，前一个门留下的放置/隐藏/选中否则会决定后一个门看到什么。

`verify:persistence` 同时守住排布的一条语义：`arrange()` 的默认放置**只填空缺**，不覆盖已恢复的状态——否则每次 reload 都会把视图拖回出厂位置，「持久化」自我撤销（去掉那条 `continue` 后该门立刻变红，是它真的在断言这件事）。

`harness.mjs` 导出 `isKnownNoise`，`own(prefix)` 会先滤掉页面固有的噪声再按前缀筛。加它的原因是实测：gateway 拉插件清单失败那条 `Failed to fetch` 的 URL 里**逐字列出了所有 bundle id**，于是"按前缀筛 prac 的日志"会把纯噪声读成 prac 的失败（`verify:split` 就先红在这一条上）。**噪声白名单是名单，不是通配**：只列已核实的几类（缺原生绑定 `spdlog`/`native-watchdog`/`fs-copyfile`/`vsda`、内置扩展激活失败、两个可选 client module 404、清单拉取失败）。

`harness.mjs` 提供启动 chromium、等 frame、控制台噪声过滤与像素质计数；`@playwright/test` 是**根 devDep**（pin 与上游同版本，两边共用浏览器缓存）。
