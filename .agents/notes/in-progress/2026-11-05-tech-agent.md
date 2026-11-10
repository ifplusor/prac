---
status: in-progress
---

# Technical agent — chat, session, plan, review, approval, artifacts

> 技术设计 L2；根见 [tech-architecture](./2026-11-05-tech-architecture.md)；行为见 [product experience](./2026-11-05-product-experience.md) / [product-mvp](./2026-11-05-product-mvp.md)。
> 本文给 chat / session / plan / review / approval / artifacts 的 prac 侧契约、数据、状态机、协议、并发、错误、测试。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：

- chat app / session 选择 / 恢复；
- plan note 的打开 / 共编；
- review：changed-files card / diff / checks；
- approval：ui-approval 的 prac 侧呈现；
- artifacts：文件 / diff / note / 后台服务；
- attention：active / recall 的接口；
- 状态机 / 持久化 / 并发 / 错误 / 测试。

**不在本 note**：DSH 的 agent 循环 / 工具 / 审批语义 → DSH；UI 文案 → [product experience](./2026-11-05-product-experience.md)；IDE 能力 → [tech-ide](./2026-11-05-tech-ide.md)。

> **约定**：“不在本 note”表示由其他 note / 系统拥有，不等于 prac 不做；真正的 non-goal 见 [product design](./2026-11-05-product-design.md) §7。

## 2. 数据 / 契约

### 2.1 prac 侧 read model

```ts
interface SessionSummary {
  id: string;
  workspaceId: string;
  title?: string;
  updatedAt?: number;
  running: boolean;
}

interface PracAgentFace {
  sessions(): readonly SessionSummary[];
  current(): string | undefined;
  subscribe(listener: () => void): () => void;
  open(sessionId: string): void;
  create(workspaceId?: string): Promise<string>;
  archive(sessionId: string): Promise<void>;
}
```

- 这是 **DSH session controller 的投影**，不是第二份 session store。
- `current` 对应 `dsh.sessions.current`；切换走 DSH controller。
- `open` 只切当前 session；不创建 window（window 由 chat app 的 `windows()` 提供）。

### 2.2 chat app

```ts
interface PracChatApp {
  id: "chat";
  instances: "single" | "multi";   // open；当前实现 single
  content(windowId: string, render): () => ReactNode;
}
```

- content 渲染 DSH `main` slot；`entryKey = conversation` / main key。
- 一个 window 一个 conversation；切换 session 时 window 的 content key 更新或重建（open）。
- **不复制 timeline**：chat timeline / tool calls 由 DSH 提供。

### 2.3 review / changed-files

```ts
interface TurnChanges {
  turn: number;
  files: readonly ChangedFile[];
  total: number;
  added: number;
  deleted: number;
}

interface ChangedFile {
  path: string;
  display: string;
  added: number;
  deleted: number;
  binary?: true;
  oversized?: true;
}

interface PracChangedFilesFace {
  summary(sessionId: string, seq: number): Promise<TurnChanges | undefined>;
  openDiff(sessionId: string, seq: number, index: number): Promise<void>;
}
```

- 数据来源：DSH `workspaceChanges.summary()` + Host turn-diff reader；`api/changes.summary` / `api/prac-turn-diff.text`。
- card 是 **DSH `conversation.chat.turnTail` 内部 slot 的 widget**；不是 board widget。
- `openDiff` → editor group preview diff；不复用 review window。
- 逐轮一张（DSH 卡保留 hover / 折叠 / 历史）；非最新也保留。

### 2.4 approval

- **没有 prac 侧 approval API**：ui-approval 是 DSH 的；prac 只挂 slot / overlay。
- 需要的数据：tool call id / status / allowed actions；由 DSH 提供。
- **不复制状态**；不新造 approval object。

### 2.5 artifacts

```ts
type ArtifactRef =
  | { kind: "file"; path: string; line?: number }
  | { kind: "diff"; sessionId: string; seq: number; index: number }
  | { kind: "note"; path: string }
  | { kind: "job"; id: string };
```

- `openArtifact(ref)` → editor / diff / note / job view；不新造 artifact object。
- 打开优先复用 editor group / preview；不每次新开 window。


### 2.6 现有事实（absorbed）

以下是 DSH 已经提供、prac 直接吸收的面；prac 只加窗口、呈现与打开动作，不新造 agent 状态对象。

- **chat**：`prac-client-dsh-host` 注册 `chat` app，`instances: "single"`，`defaultRegion: "center"`；content 渲染 DSH `main` slot，`entryKey` 取 main key；当前 admit `dsh:conversation`。`dsh.sidebar` / `dsh.rightbar` 也注册为 app，但当前只接 chat。
- **session**：title bar 读 DSH Workspace / Session controllers；`dsh.sessions.current` 是持久化选择；prac 不另存 session store。
- **changed-files**：card 注册在 `conversation.chat.turnTail`；读 turn 的 `deliverables.changes.seq`；summary 走 `api/changes.summary`，diff 走 `api/prac-turn-diff.text`；打开走 `prac.openTurnDiff`；逐轮一张；binary / oversized 禁用。
- **plan**：note 文件 + editor input；没有 plan app / plan mode。
- **approval**：ui-approval 内置；allow / reject；status / cancel 只呈现 DSH 支持的；没有 checkpoint / takeover 对象。
- **artifacts**：file / diff / note / job；打开复用 editor / diff / note / 状态；没有 artifact 对象。
- **attention**：active window 由 WM；recall 由 `views` surface；MVP 不做 return stack；不做自动布局。
- **background**：DSH job / session 状态；prac 显示状态，不新造 service 对象。

## 3. 状态机

### 3.1 Session

```text
(created) --open--> (current) --switch--> (background)
    |                  |                    |
    |                  +--archive----------> (archived)
    +------------------+--------------------+
```

- `current` 只能一个；`background` 可多个。
- 切换不销毁 window；chat window 的 content 跟随 current（或 per-window session；open）。
- archived 不删；可恢复。

### 3.2 Turn

```text
(queued) --start--> (running) --approval--> (waiting)
   |                  |                       |
   |                  +--done/error---------->|
   |                  +--cancel-------------->|
   +------------------------------------------+
```

- `waiting` 时 approval pending；allow / reject 后回 running。
- `done` 产生 deliverables（changes）；`error` 显示错误；`cancel` 只呈现 DSH 支持。
- 不新造 turn object；turn 是 DSH timeline 的一部分。

### 3.3 Review

```text
(changes announced) --card--> (summary loaded) --click--> (diff opened)
                              |                    |
                              +--missing----------> (hidden)
```

- summary 缺失 → 不渲染；diff 非 text → 行内错误；binary / oversized → 禁用。
- 只最新 turn；历史 turn 不显示（open）。

### 3.4 Plan

- plan 是 note 文件；没有独立状态机。
- 打开 / 编辑 / diff 由 editor / note 机制；冲突由文件系统 / note 机制（open）。

## 4. 协议 / DSH 映射

- **session**：DSH session controller；`ISessions` / `IWorkspaces`；`dsh.sessions.current`。
- **chat**：DSH `ctx.slots` 的 `main` keyed entry；`render("main", {}, {entryKey})`。
- **timeline / tool calls / approval**：DSH chat / tool services；prac 只订阅 / 渲染。
- **changed-files**：DSH `workspace/changes` deliverables + Host summary / turn-diff routes。
- **ui-approval**：DSH slot / overlay；prac 不解析语义。
- **plan**：工作区文件 + editor input；prac 不拥有内容。

## 5. 持久化

- **session / conversation / tool calls / approval**：DSH 持久化；prac 不复制。
- **window / active / layout**：prac frame / space / board keys。
- **plan**：工作区文件（磁盘）。
- **changed-files card**：不持久化；从 turn deliverables 重建。
- **current session**：`dsh.sessions.current`；prac 不另存。

## 6. 并发 / 顺序

- **session switch while running**：允许；旧 session 继续后台；chat window 切换 content（open）。
- **turn 完成 vs card fetch**：card 只读；summary 缺失 → 隐藏。
- **approval pending vs cancel**：cancel 只呈现 DSH 支持的；不并发改 approval。
- **plan 共编**：人 / agent 同时写 → 文件系统冲突；prac 不合并。
- **artifact open**：复用 editor group；不阻塞 chat。

## 7. 错误

| 错误 | 触发 | 处理 |
|---|---|---|
| `SESSION_NOT_FOUND` | open / archive 未知 | reject / 刷新列表 |
| `TURN_NOT_FOUND` | changed-files seq 未知 | 隐藏 card |
| `CHANGES_MISSING` | summary 缺失 | 不渲染 |
| `DIFF_UNAVAILABLE` | 非 text / 读取失败 | 行内错误 |
| `APPROVAL_CONFLICT` | 重复 allow / reject | 以 DSH 状态为准 |
| `NOTE_CONFLICT` | 共编冲突 | 交给文件 / note 机制 |
| `ARTIFACT_UNREACHABLE` | 文件 / job 不存在 | 提示 |

## 8. 测试

- **unit**：session 选择 / current / archive；changed-files summary 映射；artifact 路由；状态机非法转移。
- **L2**：chat slot → window；session switch → content；changed-files card → diff。
- **live**：chat / file / editor:group；changed-files gate planned；approval 手工。
- **planned**：session:switch / changed-files / approval:allow。

## 9. Open

1. **chat instances**：single（当前）还是 multi（一个 conversation 一个 window）。
2. **session switch 保留**：window / scroll / active 恢复范围。
3. **note 共编**：冲突 / 版本 / 可见性。
4. **approval 呈现**：chat 内 / overlay；队列 / 优先级。
5. **background service**：状态 surface / 操作。
6. **return stack**：以后是否做。
7. **changed-files 历史 turn**：是否显示。
8. **artifact 路由**：file / diff / note / job 的统一入口。

## Related

- [tech architecture](./2026-11-05-tech-architecture.md)：进程 / 模块 / 协议根。
- [tech-ui](./2026-11-05-tech-ui.md)：window / group / layout。
- [product experience](./2026-11-05-product-experience.md)：agent 行为。
- [product-mvp](./2026-11-05-product-mvp.md)：stories / 验收。
- [tech-extension-dsh](./2026-11-05-tech-extension-dsh.md)：DSH extension 注册 / 映射。
