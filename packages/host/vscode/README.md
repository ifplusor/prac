# prac-host-vscode

prac 的 **VS Code 侧策略**：`/prac-vscode` 路由、code server 的端口与起停、扩展宿主怎么起，以及 **agent 侧给扩展装什么**。机制在 `vendor/vscode-embed`（本包只是它的 consumer）。

## 它接了什么

- **一个 `ctx.lsp` provider**（`vscode-language-features`）：`.css` / `.scss` / `.less` 的 hover / definition / implementation / references，由**真的 VS Code 内建 css 扩展**回答——没有页面、没有模型也能用。
- **一个工作区一个扩展宿主**：同一工作区的 agent 共用，UI 与 agent 各用各的宿主（`docs/architecture.md` §4.2）。
- 页面那半：`/prac-vscode` 的路由与 code server 的 HTTP/WS 代理。

## 配置：agent 侧启用哪些 VS Code 扩展

**手工维护**（2026-09-21 定；agent 自己写的工具以后再说）。两个都是 JSONC 文件（注释、尾逗号合法），键与 VS Code 自己用的那两个一致：

| 层     | 文件                                    | 键                                                                                              |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 全局   | `$XDG_CONFIG_HOME/prac/settings.json`   | `extensionsIdentifiers/disabled`                                                                |
| 工作区 | `<workspace>/.agent/prac/settings.json` | `extensionsIdentifiers/disabled`、`extensionsIdentifiers/enabled`（后者可以翻过前者的全局禁用） |

```jsonc
// ~/.config/prac/settings.json —— 不需要每个工作区都起拼写检查
{
  "extensionsIdentifiers/disabled": ["streetsidesoftware.code-spell-checker"],
}
```

```jsonc
// <workspace>/.agent/prac/settings.json —— 但这个工作区要（随仓库走）
{
  "extensionsIdentifiers/enabled": ["streetsidesoftware.code-spell-checker"],
}
```

- **优先级**照 VS Code 的梯子：工作区 `enabled` → 工作区 `disabled` → 全局 `disabled` → 否则启用。
- **两个文件都不在 = 什么都不禁用 = 装着的那份全上**（等同于 VS Code 默认的"全局启用"）。
- **只写裸 id**（`publisher.name`）。VS Code 自己在这两个键下存 `{ id, uuid }` 对象，uuid 是给市场同名扩展消歧的——人手写的文件不需要它。
- **配置在扩展宿主启动时读一次**：改完要等这个工作区的宿主重启才生效。生效与否看日志：`starting the extension host for <workspace> with N of M extension(s) enabled`，以及有禁用时的 `disabled by policy: …`。
- **VS Code 自己不读这两个文件**（它那份启用状态在 storage 里，UI 走 web 时是浏览器 IndexedDB）。读它们的是本插件；另外它们会被**桥进宿主的配置模型**（`userRemote` / `workspace` 两层），所以宿主里的扩展能用 `workspace.getConfiguration` 读到文件里的其它设置项。

## 配置：webview 从哪个源加载

webview 是第三方扩展写的 HTML/JS，跑在浏览器里。它的宿主页有两条硬要求，都不是我们能绕的：

1. **安全上下文**：宿主页一开头就要 `crypto.subtle`，并且要注册 service worker（资源管线压在它身上）⇒ 必须是 `https://`（或本机 `localhost`）。
2. **宿主页的 hostname 必须等于、或前缀等于 `parentOriginHash`**（`pre/index.html`：`base32(sha256({parentOrigin, salt: webviewOrigin}))`）——而渲染器正是把这个哈希当 `{{uuid}}` 填进端点模板 ⇒ **名字必须是一条通配名**（`<hash>.<你的域>`），固定 IP 永远不行。

所以 prac 只做一件事：把部署给的端点模板交给页面。**没有配置就沿用构建自带的值（CDN）**。

```bash
# 部署侧在通配名下终止 HTTPS 并转发到这里；prac 自己保持 plain HTTP 即可
PRAC_VSCODE_WEBVIEW_ENDPOINT='https://{{uuid}}.prac.internal/prac-vscode/vs/workbench/contrib/webview/browser/pre/' \
  pnpm dsh --profile prac-dev --port 3084 --no-open
```

要提供的东西：**一条通配 DNS 记录**（`*.prac.internal` → 本机）与**一张受信任的通配证书**（内网 CA 或公网通配证书）。转发目标就是本页的 `/prac-vscode` 路由（webview 只需要 bundle 里的静态文件）。

已知仍未做：挂进 embedder 的视图**没有盒模型**（workbench 的 pane CSS 限定在 `.monaco-workbench` 之下），webview 的 overlay 因此锚在 0 高的 body 上 ⇒ 内容加载了但没上屏。
