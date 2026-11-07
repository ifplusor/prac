---
status: proposed
---

# Technical quality — security, observability, performance, a11y, i18n, persistence, testing, deployment

> 技术设计 L4 / 横切；根见 [tech-architecture](./2026-11-05-tech-architecture.md)；目标见 [product design §6.5](./2026-11-05-product-design.md)。
> 本文把质量目标变成可实现的机制：威胁模型、日志 schema、预算、测试、部署、错误分类。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：

- security / privacy / trust / secret；
- observability / logging / diagnostics；
- performance 预算 / 测量；
- accessibility；
- i18n / locale / theme；
- persistence / migration；
- testing / acceptance；
- deployment / release；
- error handling。

**不在本 note**：具体模块 API → [tech-architecture](./2026-11-05-tech-architecture.md) / [tech-ui](./2026-11-05-tech-ui.md) / [tech-widget](./2026-11-05-tech-widget.md) / [tech-ide](./2026-11-05-tech-ide.md) / [tech-agent](./2026-11-05-tech-agent.md) / [tech-extension](./2026-11-05-tech-extension.md) / [tech-runtime](./2026-11-05-tech-runtime.md)；产品体验 → [product design](./2026-11-05-product-design.md) / [product experience](./2026-11-05-product-experience.md)。

> **约定**：“不在本 note”表示由其他 note / 系统拥有，不等于 prac 不做；真正的 non-goal 见 [product design](./2026-11-05-product-design.md) §7。

**原则**：

- 本地优先：无 telemetry；日志 / 状态在本地。
- 边界清楚：DSH / VS Code / prac 各自拥有安全与状态。
- 可验证：每个面有测量 / gate / 明确 planned。
- 可回滚：部署 / 迁移 / 升级都有检查点。

## 2. Security / threat model

### 2.1 资产

- 工作区文件、git 仓库、终端；
- DSH 会话 / 工具输出 / 审批；
- extension host / 扩展 / 语言服务器；
- webview / 外部资源；
- MCP server / secret；
- 用户配置 / 扩展策略。

### 2.2 信任边界

```text
Browser（prac client）
  │  HTTPS / WS
DSH server（agent / tools / approval）
  │  child / IPC
code server（VS Code server / assets / PTY）
extension host（server 侧；language servers）
  │
webview iframe / MCP servers
```

- **browser**：不可信输入（文件内容、webview、扩展 view）；XSS / origin 风险。
- **DSH server**：可信主干；工具 / 审批 / 沙箱。
- **code server**：扩展 / 语言服务器 / PTY；扩展可执行代码。
- **webview**：第三方 HTML/JS；secure context / origin。
- **MCP server**：外部进程；工具定义来源。

### 2.3 控制

| 风险 | 控制 |
|---|---|
| 恶意扩展 | workspace trust；扩展策略；extension host 与 page extension host 分开；不自动启用未知扩展 |
| 恶意 webview | secure context；`parentOriginHash`；CSP；资源白名单 |
| 恶意 MCP server | 定义来源审查；secret 不落 UI；启动前确认（open） |
| XSS | React 转义 / 不使用 `dangerouslySetInnerHTML`；webview 隔离 |
| CSRF | same-origin / token；WS 鉴权 |
| path traversal | 文件操作走 VS Code / DSH 的路径校验 |
| terminal 注入 | 不拼接 shell 字符串；argv / PTY 写入显式 |
| secret 泄漏 | secret 存宿主；日志 redact；不写 localStorage |

### 2.4 验收

- workspace trust 关闭时 editor 不执行危险操作；
- agent 仍按自己的沙箱；
- webview 只加载白名单 origin；
- secret 不出现在页面 store / 日志；
- 扩展策略按工作区生效。

## 3. Observability / logging

### 3.1 日志 schema

```ts
interface LogRecord {
  ts: number;
  level: "debug" | "info" | "warn" | "error";
  component: string;          // dsh / code-server / ext-host / frame / extension
  event: string;              // stable event name
  code?: string;              // error code
  workspace?: string;         // hash / opaque
  session?: string;           // opaque
  requestId?: string;
  message: string;
  data?: Record<string, unknown>; // redacted
}
```

- **不记录**：文件内容、secret、完整 prompt、用户隐私。
- **redact**：secret / token / cookie / auth header。
- **sink**：code server / extension host / DSH / frame 各自日志；XDG state。
- **rotation / retention**：按大小 / 天数；MVP 手动清理（open）。

### 3.2 诊断

- gate 失败：完整 stdout / stderr + page console。
- 宿主崩溃：日志 + exitCode；可重启。
- 错误码：见 §9。
- **无 telemetry**：不上传、不聚合、不远程诊断。

### 3.3 验收

- 一次失败能在日志 / gate 定位；
- 日志无 secret；
- 无 telemetry 出站。

## 4. Performance

### 4.1 候选预算（待校准）

| 指标 | 候选 | 测量点 |
|---|---|---|
| 首帧 | ≤ 1.5s | page boot → frame visible |
| layout commit | ≤ 16ms | frame / board 一次布局 |
| CSS 镜像 | ≤ 8ms / root | 主题 / 样式表更新 |
| 同屏宿主 | ≤ 8 | window / widget root 数 |
| 内存 | ≤ 600MB | 典型 workspace |

> 这些是候选值；先测量，再定目标。没有测量就不算预算。

### 4.2 热路径

- CSS / theme 镜像（多 shadow root）；
- VS Code + DSH 混排；
- inactive 卸载 / 重挂；
- board drag / dock；
- 大 grid / 多 window；
- LSP 查询 / extension host启动。

### 4.3 测量

- `performance.mark` / `measure` 包住 boot / layout / mirror；
- gate 的 wall time；
- 内存 / 宿主数采样；
- CI 记录 baseline；回归超阈值 → fail（planned）。

### 4.4 验收

- 首帧 / 布局 / 镜像各有测量；
- 退化在 gate 看到；
- 预算数值经 James 确认。

## 5. Accessibility

- **键盘**：所有 chrome / window / board 可达；Tab 进 widget root；Escape / 方向键按区域。
- **focus**：window 是顶层边界；`shadowRoot.activeElement` 两层链；focus 可见。
- **ARIA**：tab strip / board header / actions 用正确角色；不造假按钮。
- **对比度**：主题 token；不硬编码颜色。
- **屏幕阅读器**：a11y 树穿透 shadow root；动态内容用 live region（按需）。
- **测试**：axe / 手工；a11y gate planned。
- **验收**：Tab / focus / 对比度 / a11y 树；一条 gate。

## 6. i18n / locale / theme

- **editor**：VS Code language packs；prac 不重做。
- **chat / DSH**：DSH locale；prac 不搬 i18n 三元组。
- **prac chrome**：先单语 / 双语；frame 提供 `locale` service；字符串集中，不散落。
- **fallback**：缺失 → 默认语言；不显示 key。
- **RTL**：open；至少布局可镜像。
- **theme**：来源 token → frame CSS 变量 → widget；`:host` 作用域；不互相穿透。
- **验收**：语言包 / DSH locale 生效；theme 切换不重建 root；文案集中。

## 7. Persistence / migration

- **key registry**：`prac-frame/v1` / `prac-space/v1` / `prac-board/v1`；scope = workspace hash。
- **schema version**：key 带版本；value 带 `schemaVersion`；迁移函数按版本。
- **heal**：缺字段填默认；未知 item 丢；非法 region 归默认；active 无效清空。
- **原子性**：一次写一个 key；失败保留旧值；不半写。
- **备份**：迁移前复制旧 key（可选）；失败回滚。
- **旧数据**：`views` / `viewGroups` → items；旧全局 key 丢弃；旧 docs / notes 标历史。
- **验收**：三个 key 都在；刷新恢复；旧数据 heal；迁移不丢布局。

## 8. Testing / acceptance

### 8.1 分层

- **unit**：纯函数 / 状态机 / schema / policy / 分配；
- **L2**：seam（WM → seat → catalog；extension → app；extension host handshake）；
- **live**：真实页面 / rig / gate；
- **manual**：approval / UX / a11y / 复杂交互。

### 8.2 Gate

- 现有：containers / board / stack / split / grid* / resize / persistence / space / bottom / views / file / editor:* / tabs / dynamic / lifecycle。
- 缺 P0：window:lifecycle / changed-files / lsp:query / webview:secure / extension-policy:live。
- 缺 P1：window:tab / window:active / widget:move / widget:window / isolation:mixed / commands / status / recall / a11y:focus / perf:frame。
- **note → gate**：每份 note 的 Acceptance 映射到 gate；没有 gate 的标 planned。

### 8.3 CI / 稳定性

- `vp run verify`：static → live；单 gate 用 `verify:gate`。
- **不依赖固定 sleep**；条件等待。
- 失败打印完整输出；noise 白名单。
- **成本**：full roster ~3.4 min；新 gate 先按组加。

## 9. Error handling

### 9.1 分类

| 类 | 例子 | 处理 |
|---|---|---|
| `USER` | 输入非法 / 文件不存在 | 行内提示；可改 |
| `SOURCE` | editor / SCM / search 失败 | 来源自己的错误 UI |
| `HOST` | extension host / code server 崩溃 | 重启 / placeholder |
| `NETWORK` | WS 断 / 请求失败 | 重连 / 重试（幂等） |
| `CONFIG` | policy / schema 非法 | 回退默认；日志 |
| `INTERNAL` | invariant 破坏 | boundary；日志；不静默 |

### 9.2 策略

- **边界**：每 window / overlay / extension 一个 boundary；局部失败不拖垮整页。
- **重试**：只对幂等操作；指数退避；上限。
- **降级**：code server 不可用 → editor placeholder；LSP 不可用 → 语义服务错误；webview 不可用 → placeholder；SCM / search 失败 → 来源错误态。
- **回滚**：extension per-app；迁移失败保留旧 key；部署回滚到 pin。
- **用户可见**：错误码 + 简短文案；不暴露 stack / secret。

## 10. Deployment / release

- **拓扑**：DSH server（profile）→ code server 子进程；反代 / HTTPS 通配；webview 端点模板。
- **XDG**：config / state / data；运行期状态仓库外；构建期 `.build/`。
- **构建**：client loader + types；server `dist/index.mjs`；bundle `cordis.patch.yml`。
- **升级**：pin / worktree / 比较门；不 fork 上游；升级前 `clean + build`。
- **回滚**：保留上一个 pin / profile；失败回滚。
- **多用户 / 托管**：non-goal；不做登录 / 权限系统。
- **开发环境**：bare 中心仓库 + worktrees（`prac-dev` / `prac-main`）；DSH 锚点是 `../../deepseek-harness/dsh-prac-dev`；catalog 精确 pin（当前 `0.2.1-alpha.2`）；`scripts/dsh-types.mjs --compare` 逐字节比较；前进 = 更新锚点 → `clean && build` → 改 pin → `pnpm check`。
- **验收**：HTTPS 端点 + profile 可复现；升级不破坏 workspace；回滚有检查点。

## 11. Acceptance summary

- **Security**：trust / sandbox / webview / secret 边界；
- **Observability**：日志 schema / redact / 无 telemetry；
- **Performance**：候选预算 + 测量；
- **A11y**：键盘 / focus / 对比度 / a11y 树；
- **i18n / theme**：来源消费 / fallback / 不穿透；
- **Persistence**：版本 / heal / 迁移 / 原子性；
- **Testing**：unit / L2 / live / gate；
- **Error**：分类 / boundary / 重试 / 降级 / 回滚；
- **Deployment**：HTTPS / profile / upgrade / rollback。

## 12. Open

1. **Performance 数值**：候选预算待校准。
2. **A11y 目标**：最小基线 vs WCAG。
3. **i18n 范围**：prac chrome 全量 / RTL。
4. **Secret / MCP trust**：存放 / 确认。
5. **日志 UI**：是否做。
6. **Deployment**：生产 / 证书 / 多机。
7. **Testing**：L2 覆盖 / gate 并行 / 成本。
8. **Error 文案**：错误码 / 用户提示等级。

## Related

- [tech architecture](./2026-11-05-tech-architecture.md)：进程 / 模块 / 协议根。
- [tech-runtime](./2026-11-05-tech-runtime.md)：extension host / webview / policy。
- [tech-ui](./2026-11-05-tech-ui.md)：隔离 / a11y / 持久化。
- [tech-extension](./2026-11-05-tech-extension.md)：extension / catalog / host capability。
- [product design](./2026-11-05-product-design.md)：质量期望。
- [docs/ui-acceptance.md](../../../docs/ui-acceptance.md)：gate 目录。
