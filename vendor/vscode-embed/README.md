# prac-vscode-embed

把 `prac-vscode` 构建出的 Code - OSS 产物**包成一个可嵌入的 lib**：机制在这里，策略在消费方。

- **机制**（本包）：产物同源服务、code server 的 HTTP/WS 代理、每页一次 boot、part host 元素、主题类拷贝、命令面。
- **策略**（消费方）：路由 path、code server 端口、仓库里产物在哪、工作区是哪个、哪个 view 对应哪个 part、什么时候允许 boot。
- **它不知道 prac，也不知道 DSH**：环境变量、profile、Cordis 服务都不出现在这里；`packages/host/vscode` 与 `packages/client/vscode-host` 是它的两个 consumer。

## 两个入口

| 入口                                | 平台   | 内容                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`（`src/host/index.ts`）          | Node   | `resolveBundleRoot()`（从消费者所在目录向上找产物）、`resolveCodeServerSegment()`（从 `product.json` / git HEAD 推 `<quality>-<commit>`）、`createAssetHandler({ root })`、`createCodeServerProxy({ host, port })`                                            |
| `./client`（`src/client/index.ts`） | 浏览器 | `createVscodeEmbed({ route, productName, … })` → `{ boot({ workspacePath }), partHost(partId), view(viewId), commands(), host(), error(), page }`；并再导出 `prac-vscode` 的 embed 契约（`EMBED_BRIDGE` / `PART_HOST_ATTR` / `EmbedBridge` / `PartHostFace`） |

导出的是**源码**（TS），与 `prac-vscode` 一样，所以消费方在构建期直接编译它，本包没有打包步骤、没有 `build` 脚本（`vp run -r build` 不会碰它）。

## 页面级状态只有一个家

消费方各自的 client bundle 会**各自内联一份**这个模块，所以状态不能放在模块作用域：

- 每页一次的 boot 守卫、boot 元素、命令面、失败原因、part→元素表，全在 `globalThis.__vscodeEmbed` 这**一个**记录上（`VscodeEmbedPage`）；
- 谁先 boot、谁后挂 host 都成立：`publish` 拿到的面会把记录里已有的 host 全部 `movePartInto` 一次，之后新挂的 host 直接进面。

## 两级单位

- `partHost(partId)`：workbench 的**部件**（titlebar / sidebar / editor …），页面单例，只能搬不能重建。
- `view(viewId)`：**单个 view**（如 `workbench.explorer.fileView`）——它自带的 pane（header + body），不经过 container，也不在任何 part 里；组件卸载时 `releaseView` 释放它，因此可以再次创建。**这是 prac 组合的单位**（container / part 是可选的高级形态）。

## 它不做什么

- 不决定**哪个 part 该出现**，也不决定它放在哪：`partHost(partId)` 只交出一个元素。
- 不碰工作区/存储/远程身份：`boot({ workspacePath })` 把工作区当参数收下，由消费方从它自己的世界（对 prac 而言是 DSH 的工作区注册表）解析。
- 不做扩展宿主、不碰 VS Code 的服务图——那是补丁载荷（`vendor/vscode/overlay/embeddedWorkbench.ts`）与上游 bootstrap 的事。

## 上游契约在哪

`EMBED_BRIDGE`（options 字段名）、`PART_HOST_ATTR`（part host 属性名）、`PartHostFace` / `EmbedBridge` 类型都定义在 `vendor/vscode/overlay/embedBridge.ts`——那份文件会被构建 stage 进 checkout 供两侧编译，所以它是**唯一的家**；本包只再导出，不重新拼写。
