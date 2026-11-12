---
status: in-progress
---

# Technical extension — VS Code adaptor

> 技术设计 L3；扩展模型见 [tech-extension](./2026-11-05-tech-extension.md)；WM / frame 见 [tech-ui](./2026-11-05-tech-ui.md)；editor host / IDE 能力见 [tech-ide](./2026-11-05-tech-ide.md)；runtime 见 [tech-runtime](./2026-11-05-tech-runtime.md)。
> 本文写 VS Code 侧怎么变成 prac extension：host extension 提供 `prac.vscodeHost`，editor / views extension 依赖它贡献 app / widget；不重复扩展契约、editor host、WM。
> 验收由 James 签字。

## 1. 覆盖与边界

**本 note 覆盖**：

- `prac.vscode-host` / `prac.vscode-editor` / `prac.vscode-views` 三个 extension；
- client 侧 VS Code host（embed / face / catalog / boot）；
- `package.json` `contributes` + 实时 catalog / when 的自动转换；
- `ViewContainer` / `View` → `PracWidgetDef` + `PracWidgetImpl`；
- editor input → editor app 的 `open`（每个 input 一个窗口）；
- 动态贡献的 reconcile；
- 错误 / 测试。

**不在本 note**：

- extension / catalog / reconcile 契约 → [tech-extension](./2026-11-05-tech-extension.md)；
- editor host 内部（pane host / editor group）→ [tech-ide](./2026-11-05-tech-ide.md) §2.1；
- WM / frame / placement → [tech-ui](./2026-11-05-tech-ui.md)；
- server 侧 `prac-host-vscode`（code server / server extension host）→ [tech-runtime](./2026-11-05-tech-runtime.md)。

## 2. Extension 划分

```mermaid
flowchart LR
  H["prac.vscode-host<br/>provides prac.vscodeHost"]
  E["prac.vscode-editor<br/>dependsOn vscodeHost"]
  V["prac.vscode-views<br/>dependsOn vscodeHost"]
  W["PracAppDef / PracWidgetDef<br/>声明"]

  H -->|capability| E
  H -->|capability| V
  E --> W
  V --> W
```

- **host extension**：`manifest.id = "prac.vscode-host"`，`provides: ["prac.vscodeHost"]`；只 boot / embed / face，不贡献 app / widget。
- **editor extension**：`dependsOn: ["prac.vscodeHost"]`；`apps()` 返回 editor `PracAppDef`；`appRuntime(def)` 返回 `{ match, start }`；`start(resource)` 创建窗口并在创建时绑定 VS Code 的 renderer（一个正在编辑的文件 = 一个 `PracWindow`；tab strip 的 tab 是 window group 的 window，不是 window 内的 tab）；renderer 返回 VS Code 渲染的宿主（`TextEditorPane`，不是 `PracWindowPane` 空 pane；见 [tech-ui](./2026-11-05-tech-ui.md) §2.3–§2.4）。**不**声明 `windows`。
- **views extension**：`dependsOn: ["prac.vscodeHost"]`；`widgets()` 返回 `PracWidgetDef`；`widgetRuntime(def)` 返回 `{ hostFor, wrap }`；不声明宿主、不声明窗口。
- vscode host 私有地记录它贡献的 app / widget（不写进通用 contract）；host 未 ready → editor / views disabled / degraded。
- 扩展只贡献**声明**：`PracApp` / `PracWidget` 是运行时组合（def + impl），`PracWindow` 是 WM 的实体，三者都不由 extension 直接产出。

**Cordis 接法**：

- host extension 在 `apply(ctx)` 里 `ctx.provide("prac.vscodeHost", face / host)`；
- editor / views extension 用 `inject: ["prac.vscodeHost"]`；
- contribution 对象用 `ctx.pracExtensions.register({ ... })` 注册；`ctx.effect` 负责 dispose。
- 不另写 extension activation / dispose 生命周期。

## 3. VS Code host（client 侧）

这里的 host 是 **client 侧** `prac-client-vscode-host`，不是 server 的 `prac-host-vscode`。它把 VS Code web workbench 嵌进 prac page，并把 workbench 的 catalog / command / editor 面桥成 `PracVscodeFace`；不拥有 WM / frame / placement。

### 3.1 包 / 角色

- `prac-client-vscode-host`：boot / workbench host element / bridge / face / catalog / commands；提供 `prac.vscodeHost`。
- `vendor/vscode-embed`：boot、资产、宿主元素、command face、bridge；机制层。
- `vendor/vscode`：上游 pin + patch + overlay；不 fork。
- `ui-vscode-views` / `ui-vscode-editor`：feature extension 的实现包，消费 face。

```mermaid
flowchart LR
  Page["prac page"] --> Host["prac-client-vscode-host"]
  Host --> Embed["vendor/vscode-embed"]
  Embed --> WB["VS Code web workbench"]
  WB --> Face["PracVscodeFace"]
  Face --> Providers["ui-vscode-views / ui-vscode-editor"]
  Providers --> Ext["prac extension apps / widgets"]
```

### 3.2 启动 / 生命周期

```mermaid
stateDiagram-v2
  [*] --> booting: page boot
  booting --> ready: workbench + face
  booting --> failed: boot error
  ready --> ready: catalog / onDidChange
  ready --> [*]: page unload
  failed --> booting: retry
```

- page boot：host extension 起 workbench host element；资产经 code server / proxy；secure context 见 tech-runtime。
- workbench ready + face ready → `prac.vscodeHost` capability ready；editor / views extension 才启用。
- host 失败：placeholder + 诊断；可 retry；不创建 window、不写 board。
- page unload：dispose host / face；hostFor 不再调用。
- host 是 **page 侧**，不是进程；code server / extension host 仍在 server 侧。

### 3.3 Face 边界

`PracVscodeFace` 是 `prac.vscodeHost` 暴露给 feature extension 的桥：

- `catalog` / `onDidChangeCatalog`；
- `hostFor` / `mountView` / `releaseView` / `focusView`；
- `containerActions` / `editorActions` / `runAction` / `runEditorAction`；
- `capabilities.editors`：snapshot / subscribe / settled / version / actions。

边界：

- `PracVscodeFace.hostFor(view)` 是 view 宿主；`PracWidgetImpl.hostFor(widgetId)` 是 widget 宿主；同名但不同层。
- face 不拥有 window / group / placement。
- editor host 的 pane / editor group 细节在 [tech-ide](./2026-11-05-tech-ide.md) §2.1。

### 3.4 四层与边界

```
WM / frame（决策）
  → vscode-host（镜像 + 映射 + 内容）
  → embed overlay（VS Code 契约实现）
  → vendored VS Code（不变）
```

| 层 | 职责 | 不做 |
| --- | --- | --- |
| **WM / frame** | 窗口存在性、region、group、placement；渲染 `prac.window` 槽 | VS Code 概念（input / group / pane） |
| **vscode-host** | boot / embed；face；文件 → editor input；把 WM 的窗口镜像给 embed；提供宿主渲染 app 的内容 | 决定窗口存在性、region、打开管线 |
| **embed overlay** | 实现 `IEditorGroupView` / `IEditorGroupsService` / `IEditorService`；group / pane / projection | 决定窗口集合、知道业务 app |
| **vendored VS Code** | 上游行为 | — |

**接口**

- WM → host：`pracWindows.getSnapshot()` / `subscribe`（单向）；
- host → embed：`mapWindow` / `mountViewInto` / `mountFileInto` / `openFile`（单向）；
- embed → host：`embedBridge` face（回调）；
- embed → vendored：`IEditorService` / `IEditorGroupsService` 契约（实现）。

**两条流**

窗口流：`admit → getSnapshot → mapWindow → ensureGroup(region) → PracWindowInput + PracWindowPane → mapped()`。

打开流：`prac.open → registry → app.open / pracVscode.open → editorService.openEditor({ resource }) → TextEditorInput + TextEditorPane`。

**不变量**

- 窗口存在性 / region / group 的写者只有 WM；
- embed 不自行创建窗口，只镜像；
- `mapped()` 是 WM 窗口的投影，不是 editor group 的；
- `groupForRegion` / `ensureGroup` 是 region → group 映射，按需创建；
- 内容是 app 的，frame 渲染，editor pane 是 VS Code 的；
- embed 不调 `prac.open`。

## 4. 自动转换

VS Code 侧要合并两类输入：

1. **静态**：`package.json` 的 `contributes`；
2. **动态**：extension 激活 / 停用、`when` context、view 的 active 状态、commands / menus 的当前解析。

```mermaid
flowchart LR
  P["package.json contributes"] --> C["catalog builder"]
  L["live catalog / when"] --> C
  C --> AD["PracAppDef"]
  C --> WD["PracWidgetDef"]
  AD --> A["app layer"]
  WD --> W["PracWidgets"]
```

- `ViewContainer` → board hint；`View` → `PracWidgetDef`；
- `EditorInput` → editor app 的 `open` 声明窗口（每个 input 一个窗口，不再是 `windows()` 列表）；
- commands / menus → resolved action model（不是 app / widget def）；
- 只注册 **active** view；`when` 变化就进出；
- 不搬 `visible`：VS Code 显隐不能成为第二个“在屏上”的真相源；
- 转换由 adapter 负责，VS Code extension 作者不写 prac manifest。

## 5. 映射

- **ViewContainer** → widget board；由 widget board app 打开 board window。container 只是默认 board hint，不是所有权。
- **View** → `PracWidgetDef` + `PracWidgetImpl.hostFor`；默认 board hint 来自 container；frame / workbench 决定最终 placement。
- **EditorInput** → editor app 的 `open` 声明窗口；每个 input 一个 `PracWindow` 投影；editor host 见 tech-ide §2.1。
- **editor group** → window group 的 adaptor runtime；一个 stage region 一个 editor group；不拥有 chrome / window 记录。
- **actions / commands**：`containerActions` / `editorActions` / `runAction` / `runEditorAction` → resolved action model；frame 渲染。
- **webview / custom editor**：`EditorPane`；secure context 由 runtime 管。

## 5.1 投影：prac window → VS Code

**判据是“窗口内容由谁渲染”，不是一个叫 origin 的枚举。** host extension 有 vscode、dsh，以后可能更多；extension 机制不假设只有这两种。

- **窗口标注为非 vscode 原生**的窗口：`PracWindowInput`（身份投影）+ `PracWindowPane`（空 pane），内容由 prac 的 frame 渲染；adaptor 对 **stage 的所有窗口**做映射，这一路用占位 input。判据来自窗口的标注（`PracWindow.tags`），不是 app 的来源。
- **宿主渲染**（由 VS Code 这类机制渲染的窗口）：由宿主自己的机制渲染——editor 用 `TextEditorInput` + `TextEditorPane`，其它宿主内容用各自宿主；它们**不是** `PracWindowInput`，也不经 `windowProjection.map`。

分流依据是窗口创建时绑定的 renderer/host（frame 还是宿主），不是 `origin` 字符串。

**镜像，不是权威**：`PracWindowInput` 由 WM 的窗口驱动，embed 不决定窗口是否存在。

- `PracWindowGroup`：prac 的 window group，实现 `IEditorGroupView`，借用 `EditorGroupModel` / `PracEditorPaneHost` / pane 类；
- `PracWindowPane`：frame 渲染窗口的空 pane（内容在 prac frame）；
- `mapped()` 返回 WM 投影过的窗口（`inputs.keys()`），不问 editor group；
- `map(region)` 在 region 没有 group 时先 `ensureGroup(region)`，不丢弃窗口；
- 窗口的 region 来自 WM 的 placement（`pracFrame.getState().items[id].region`），不从“有没有文件窗口”推导。

## 5.2 vscode host 的记录表

窗口的 `tags` 标出“来自哪个机制”；但 `IEditorInput` / `IEditorPane` 的具体对象是 VS Code 内部的，core 不表达。vscode host 维护自己的记录表：

```ts
Map<windowId, { input: IEditorInput; pane?: IEditorPane }>
```

- 用于 editor 关闭 ↔ 窗口关闭的联动；
- 用于 `CustomEditorInput` / `WebviewEditor` 的 pane 映射；
- 用于 `windowProjection.map` 的“该不该映射”判断；
- 不写进 core，不进 `PracExtension` 契约。

## 6. 动态 / 错误 / 测试

- 贡献变化 → catalog version 更新 → reconcile；不重启。
- 单 view mount 失败 → placeholder + log；不阻塞其他 view。
- `DUPLICATE_WIDGET` / `DUPLICATE_APP`：id 冲突 → reject。
- `UNKNOWN_WIDGET`：hostFor / wrap 未知 → 空 host。
- catalog version 落后 → 重读；不缓存。
- 并发：catalog 更新与 mount / release 串行；dispose 后不再 mount。
- 测试：
  - unit：catalog diff / view → widget def / editor → app def / duplicate；
  - L2：view mount / release / focus；editor input → window；
  - live：containers / editor:group / actions；
  - planned：commands / status / notifications / webview。

## 7. Open

1. **非 editor input 的 capabilities**：chat / board 的 dirty / save / preview / move / tabGroups。
2. **catalog active / visible 边界**：`hideIfEmpty` 由谁执行。
3. **editor host 切片**：S2b / S3 / S4；见 tech-ide §2.1。
4. **actions 覆盖**：commands / menus / status / notifications 的 gate 还缺。

## Related

- [tech-extension](./2026-11-05-tech-extension.md)：manifest / catalog / reconcile。
- [tech-ui](./2026-11-05-tech-ui.md)：PracWindow / WindowPlacement / board。
- [tech-widget](./2026-11-05-tech-widget.md)：PracWidget / WidgetPlacement。
- [tech-ide](./2026-11-05-tech-ide.md)：editor host / IDE 能力。
- [tech-runtime](./2026-11-05-tech-runtime.md)：server 侧 extension host / webview。
- [tech-packages](./2026-11-05-tech-packages.md)：包职责。
