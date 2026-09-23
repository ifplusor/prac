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
PRAC_VSCODE_WEBVIEW_ENDPOINT='https://{{uuid}}.prac-code-resource.ifplusor.win/prac-vscode/vs/workbench/contrib/webview/browser/pre/' \
  pnpm dsh --profile prac-dev --port 3084 --no-open --trusted-host prac.ifplusor.win
```

`--trusted-host` 不是可选项，理由在下面第 3 条前置里。

## 部署：在内网把那个源供起来（OpenWrt 的 UCI nginx）

下面是最小配方。以 James 的内网为例：应用名 `prac.ifplusor.win`，webview 源 `*.prac-code-resource.ifplusor.win`，DSH 跑在 `192.168.1.10:3084`。OpenWrt 的 nginx 主配置是 init 每次起停从模板**现生成**的 `/etc/nginx/uci.conf`——只改 UCI 与 `/etc/nginx/conf.d/` 里的文件，别改生成物。

**三条前置**，缺一条这套配置都白配：

1. **两个名字都解析到路由器**。dnsmasq 里写一条 `prac-code-resource.ifplusor.win` 就够，它连子域一起答（`--address=/<域>/<ip>`）。
2. **路由器够得到 DSH**。现在够不到——见本节最后的「卡住的地方」。
3. **DSH 启动时带 `--trusted-host prac.ifplusor.win`**。`/api` 前面有一道浏览器信任栅栏，要求请求的 `Host` 是环回或已声明的权威名（`packages/client/connection/src/api-request-trust.ts` 的 `isTrustedApiRequest`）；而 nginx 这边又**必须**透传原始 `Host`（改写成 `127.0.0.1:3084` 会立刻被同一道栅栏的 Origin 比对挡掉）。⇒ 少了这个参数，页面能开、每个 `/api` 请求返 403。

### 1. 让 nginx 接管 80/443

`luci-nginx` 自带的 uci-defaults 会把 uhttpd `disable` 并 `stop`，再 `enable` + `start` nginx（`net/nginx/files-luci-support/60_nginx-luci-support`）。`luci-ssl-nginx` 在 24.10 与 master 上都不是独立包，只是 `luci-nginx` 声明的 provides，所以装一个就够：

```sh
opkg update && opkg install luci-nginx      # 24.10 及更早；snapshot 用 apk add
service nginx status
```

### 2. 证书

`/etc/config/acme`（acme 插件；通配名只能走 DNS 验证）：

```
config cert 'prac'
	option enabled '1'
	option staging '0'
	list domains 'prac.ifplusor.win'
	list domains 'prac-code-resource.ifplusor.win'
	list domains '*.prac-code-resource.ifplusor.win'
	option validation_method 'dns'
	option dns 'dns_你的服务商'
	list credentials 'XXX="…"'
```

```sh
uci commit acme && service acme renew
```

证书文件名跟着 `list domains` 的**第一条**走（`acme.init` 取 `main_domain`，`acme-acmesh/files/hook.sh` 的 `link_certs` 再用它命名），所以这条配置的产物是 `/etc/ssl/acme/prac.ifplusor.win.fullchain.crt` 与 `/etc/ssl/acme/prac.ifplusor.win.key`。`ssl_certificate` 指 `fullchain.crt`——它指向 acme.sh 的 `fullchain.cer`，叶证书与中间证书都在里面。

**续期不用自己接钩子**：acme 在 `renewed` 时发 `ubus call service event acme.renew`（`acme-common/files/acme-notify.sh`），nginx 的 init 给这个事件挂了 `reload`（`net/nginx/files/nginx.init` 的 `service_triggers`）。只有**第一次签发**不自动（那发的是 `acme.issue`）⇒ 签发完手工 `service nginx reload` 一次。

### 3. UCI server 段

```sh
uci set nginx.prac='server'
uci add_list nginx.prac.listen='443 ssl'
uci add_list nginx.prac.listen='[::]:443 ssl'
uci set nginx.prac.server_name='prac.ifplusor.win *.prac-code-resource.ifplusor.win'
uci set nginx.prac.ssl_certificate='/etc/ssl/acme/prac.ifplusor.win.fullchain.crt'
uci set nginx.prac.ssl_certificate_key='/etc/ssl/acme/prac.ifplusor.win.key'
uci set nginx.prac.ssl_session_cache='shared:SSL:32k'
uci set nginx.prac.ssl_session_timeout='64m'
uci add_list nginx.prac.include='conf.d/prac-server.inc'
uci commit nginx
```

两个名字放一段 server 是够的：webview 要的是「另一个**源**」，而源是 `scheme://host:port`——同一段 server 里两个 `server_name` 本来就是两个源。要是两个名字各有一张证书（`prac.ifplusor.win` 一张、`*.prac-code-resource.ifplusor.win` 一张），就开两段，各配各的 `server_name` 与 `ssl_certificate`，共用同一个 `.inc`。

三条会咬人的细节：

- **段名不能和 `conf.d/<段名>.conf` 同名**。生成器发现有这个文件，会把**整段 server 换成一行注释**（`skipped UCI server 'nginx.prac' as it could conflict with: …`，`net/nginx-util/src/nginx-util.cpp` 的 `create_server_conf`）⇒ 所以下面那个 http 级文件叫 `prac-ws.conf`，不叫 `prac.conf`。
- **`uci_` 开头的选项被逐字跳过**（同一个函数）。所以**不要**在这段里写 `uci_manage_ssl`——那是 `nginx-util add_ssl` 留下的记号，写了它就会来接管你的证书。
- **选项值逐字变成 `key value;`**，`location {}` 这类块指令塞不进 UCI（会多出一个分号，nginx 报语法错）⇒ locations 只能走文件。

### 4. locations

`/etc/nginx/conf.d/prac-server.inc`：

```nginx
location / {
	proxy_pass http://192.168.1.10:3084;
	proxy_http_version 1.1;
	proxy_set_header Host $host;
	proxy_set_header X-Forwarded-Proto $scheme;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection $prac_connection_upgrade;
	proxy_read_timeout 3600s;
	proxy_send_timeout 3600s;
	proxy_buffering off;
}
```

整个源都转给 DSH 是必须的：prac 的页面在 `/`，`/prac-vscode` 只是它引的 bundle 加上 code server 的 HTTP/WS 代理，同源才拼得起来。

**文件名故意不用 `.locations`**：默认那段 `_lan` server 自带 `list include 'conf.d/*.locations'`（`net/nginx-util/files/nginx.config`），会把每个 `.locations` 收进去；我们的 `location /` 一进去，`https://192.168.1.1/` 就从 LuCI 变成 prac 了。`.inc` 不在 `*.conf` / `*.locations` 这两条 glob 里，只被上面那段 server 显式 include。

### 5. WebSocket 要用的那个变量

生成的模板里**没有** `$connection_upgrade`，照网上抄会报 `unknown "connection_upgrade" variable`。自己定义，`/etc/nginx/conf.d/prac-ws.conf`：

```nginx
map $http_upgrade $prac_connection_upgrade {
	default upgrade;
	''      close;
}
```

`*.conf` 会被 include 进 `http{}`，map 正是 http 上下文的指令；变量名加前缀是为了不和别的包撞。不想多这个文件，就把 `.inc` 里那两行 `proxy_set_header` 换成 `proxy_set_header Connection "upgrade";`——效果一样，代价是普通请求也顶着 upgrade 头。

### 6. 起、看、验

```sh
service nginx reload
nginx -T | grep -A24 "nginx.prac"        # 看生成出来的那段 server
curl -sI https://prac.ifplusor.win/prac-vscode/vs/workbench/contrib/webview/browser/pre/index.html
openssl s_client -connect prac.ifplusor.win:443 \
  -servername 2abc.prac-code-resource.ifplusor.win </dev/null 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName
```

浏览器里看三样：webview 的 iframe `src` 是 `https://<52 位 base32>.prac-code-resource.ifplusor.win/…`；那条源被 service worker 接管；**没有任何去 `vscode-cdn.net` 的请求**（`*.vscode-resource.vscode-cdn.net` 那几条是 SW 自己合成的，不是外网流量）。

我们这段 server 没有 include `restrict_locally`，所以 prac 这两个名字只受防火墙管：以后要走 VPN 或开给公网，加一条 firewall 规则就行，nginx 不用动。

### 让路由器够得到 DSH：绑全部接口 + 声明公开名

DSH 默认只绑环回，而 `dsh --host 0.0.0.0` 被**有意拒绝**（`intentionally not supported yet for safety: it would expose remote code execution to the network`，`packages/bundle/web-app/src/startup.ts`），webserver 的 schema 也只认 `127.0.0.1` / `0.0.0.0` 两个字面量。

**选定的落点**（2026-09-23）：不改 DSH，改**这个 profile 自己的 patch 层** `$DSH_HOME/profiles/<name>/cordis.patch.yml`——它排在每个 bundle 层之后，是「部署事实」该待的地方；写进 prac 仓库那个 bundle patch 等于让所有 `prac-dev` 都绑 LAN。上面 `proxy_pass` 的目标也就跟着变成这台机器的 LAN 地址。

```yaml
- id: webserver
  config:
    host: '0.0.0.0'
    port: !!js ctx.webStartup.port ?? 3080
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024

- id: connection
  config:
    trustedHosts: !!js "['prac.ifplusor.win', ...ctx.webRuntime.trustedHosts]"
```

三个必须知道的点：

- **patch 对 `config` 是整体替换，不是深合并**（`vendor/include` 的 `applyEntryPatches` 只按顶层键赋值）⇒ 覆盖 `webserver` 时要把上游那行的 `port` 与 gzip 三个字段一起重抄，否则退回 schema 默认。`inject` 是另一个顶层键，不受影响。
- **`!!js` 只认标量**（同一处的 `JsExpr` 是 `kind: 'scalar'`）⇒ 数组表达式要加引号。上游 `packages/bundle/web-app/cordis.patch.yml` 在 `connection` 那行注释里给的例子写成裸的流式序列，照抄会 `unknown tag !<!js>`，配置起不来。
- `connection` 那行的拼接**就是上游注释给的写法**：LAN 字面量由 bind 推出，公开名我们加上；`web-runtime` 那行不用动。用户 patch 层还能引用 `process.env`，想「只有显式设了变量才绑 LAN」就把 `host` 写成 `!!js process.env.PRAC_WEB_HOST ?? '127.0.0.1'`。

验证要用 `--dump-config`，**不能用 `--dump-default-config`**（后者故意不含用户层）：

```sh
pnpm dsh --profile prac-dev --dump-config | grep -A9 '^- id: webserver'
```

`patchReload` 是 `startup` ⇒ 改完要**重启 DSH** 才生效。重启后从 LAN 走应用名与通配子域各拉一次，都该是 200。
