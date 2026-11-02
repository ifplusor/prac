---
status: in-progress
---

# Agent Note: UI framework — 分层、对象与包

> 这是 prac UI 的组合模型 umbrella。editor window 的实现边界见 [2026-10-07-editor-host.md](2026-10-07-editor-host.md)；VS Code adaptor 见 [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)；隔离见 [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)；几何 / grid 契约见 [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)。产品设计见 [2026-10-23-ui-scheme.md](2026-10-23-ui-scheme.md)。

## Summary

prac 的 UI 建立在两个生态之上：VS Code（editor / view container / view）和 DSH（client slot / React 组件 / store）。我们不直接复用它们的布局，而是**复用它们的 UI 实现与运行时，自己拥有组合模型**：

- **通用 UI 框架**：`prac-ui-kit-layout` → `prac-ui-kit-content` → `prac-ui-kit-workbench`，每一层可独立使用；
- **prac 应用层**：Application / Window / Widget board / Widget、内容种类、来源、catalogue、默认 arrangement。

对象层级：

```text
Frame shell（frame 级：dock / sidebar / panel / chrome）
  └─ Stage
       └─ Space（stage 的虚拟桌面）
            └─ LayoutRoot(kind: "space")
                 └─ Region
                      └─ ContentRoot
                           ├─ ContentGroup（tabs / stack）
                           ├─ ContentItem（单个内容）
                           ├─ LayoutRoot（board / 嵌套布局）
                           └─ opaque host
```

`ContentRoot` 是 region 的内容根；`content` 可以是 group、单个 item、`LayoutRoot` 或 opaque host。`WindowGroup` 是 `ContentGroup<Window>`，`Window` 是 `ContentItem<WindowContent>`。

frame 拥有布局拓扑、window group / window、Space、active、tab strip 与 chrome 边界；source 拥有内容实现；adapter 在 prac 与 VS Code / DSH 之间翻译；bundle 只做 composition root。

## Motivation

prac 同时依赖两个 UI 生态：

- **VS Code**：IDE 的 editor、view container、view、action、overlay、webview；
- **DSH**：client 插件、slot、React 组件、store、locale、theme。

两边的 UI 贡献方式不同。如果按各自模型直接摆，会出现两套布局、两套生命周期、两套 active。prac 的目标是：

> **复用两边的 UI 实现与运行时，但不复用它们的 layout；组合、placement、surface 边界归 prac。**

因此需要一套自己的组合模型，同时满足：

- VS Code 的 view 可以重组（Timeline 从 Explorer 拖到 right sidebar / 单 view 容器）；
- window 由 application 打开，不存在无主 window；
- DSH slot 与 VS Code view 可以在同一套对象模型里表达；
- frame 不认识 `vscode:` / `dsh:` 来源。

同时，这套框架不能只为 prac 服务：它需要按层提供独立的使用面，让只想做 window 内容的应用不必接受 window / space / frame 的全部基础设施。

## 分层模型

每一层都是**独立可用的产品**，不是内部模块；消费者可以停在任意一层：

| 层 | 包 | 能独立用于 | 依赖 |
|---|---|---|---|
| **L0 Layout** | `prac-ui-kit-layout` | 任意 split / grid / region 布局 | 无 |
| **L1 Content** | `prac-ui-kit-content`（partial） | **window 内部的内容工作区**：content root / group / item / placement / store | L0 |
| **L2 Workbench** | `prac-ui-kit-workbench` | Space（stage 虚拟桌面）、Window / WindowGroup、Board / Widget、frame shell | L0 / L1 |
| **L3 Prac app** | `prac-client-*` | editor / chat / board 内容、DSH / VS Code 来源、catalogue、默认 arrangement | L2 |

依赖只能向下：

```text
prac-ui-kit-layout        L0 pure layout
   ↑
prac-ui-kit-content     L1 content（window 内容可独立使用）
   ↑
prac-ui-kit-workbench   L2 Space / Window / Board / Widget / frame shell
   ↑
ui-frame / ui-widget / adapters
   ↑
ui-workbench / bundle
```

L1 的独立用法：一个自带 window 的应用，可以在 window 内容里使用 regions / content roots / tabs / stack / sash，不需要 window group / space / frame shell。

### 层级中的关键概念

- **Frame shell**：workbench 外壳，frame 级；dock / sidebar / panel / chrome 与 stage 平级。
- **Stage**：中央工作区；承载当前 Space。
- **Space**：stage 的虚拟桌面；命名的 stage 布局；拥有一个 `space root`。它不是 layout root、不是 store、不是 project folder。
- **LayoutRoot**：一棵几何树 + owner kind；kind 为 `"frame" | "space" | "board"`。
- **ContentRoot**：region 的内容根；其 `content` 是 group / item / layout root / opaque host。
- **ContentHost**：内容端点（`mount` / `release` / `focus?`）；模型不持有 DOM。
- **WindowGroup**：`ContentGroup<Window>`；**Window**：`ContentItem<WindowContent>`；**Board**：window content 里的嵌套 `LayoutRoot`；**Widget**：board 的 `ContentItem`。

### 目标模型：层是能力，binding 是连接

对外只保留这条链：

```text
Region
  └─ ContentRoot
       └─ content
            ├─ ContentGroup → ContentItem[]   （可选）
            └─ 单个 content
```

- **Group 不是必经层**：单个 editor / 终端 / plain panel 可以直接是 `ContentRoot` 的 content；
- **RegionContent 不是一层**：它只是 “region 的 content root + 可选 group + 可选 host” 的组合；不进入模型词汇；
- **binding 只有一种记录**：`regionId` 指向一个 `ContentRoot`；group 从 `root.content` 取，不重复存储；
- **host 只有一条挂载路径**：`ContentHost` 是唯一的内容端点；`ContentMount` 已删除；
- **`RegionContent` / `RegionContentRegistry` / `RegionBinding` 是当前实现名**；`Surface` / `FrameSurface` / `FrameGroup` 已删除。

目标 binding：

```ts
interface RegionBinding {
  readonly regionId: string;
  readonly root: ContentRoot;
  readonly bridge?: GroupBridge; // 仅当 content 是 group
}
```

渲染路径：

```text
region → binding.root
  → content 是 group ? bridge 投影 placements → LayoutState.items
                   : 直接渲染单个 content
  → LayoutRenderer / chrome
  → host.mount(element)
```

## 对象模型

### Application

Application 是**启动身份**，不是内容容器。

- 定义可打开的 window kind、single / multi、默认 placement、默认 composition、launcher / command；
- **window 只能由 app 打开**；
- app 可以是 content app（editor / chat / terminal / browser）或 board host（board window 的 host）；
- app 不拥有 widget 的实现；widget 的 source 独立；
- **VS Code workbench / DSH 是 source / runtime，不是 prac app**；它们提供 editor input / view，prac app 是打开 window 的内容身份；catalogue 的 `appId` 是 source id，不是 prac app。

### Window

Window 是 app 打开的实例，有 placement、生命周期、active。

| window kind | 内容 | 例子 |
|---|---|---|
| **application window** | app-owned 内容 | editor（一个文件）、chat、diff、terminal、browser、settings |
| **widget board window** | 一个 widget board | stage / sidebar / panel 上的 Explorer board、单 Timeline board |

- **所有 window 在 adapter 侧都有 1:1 的 `EditorInput` 投影（含 chat / board window）；投影只承载身份 / 元数据，内容仍由 frame 渲染**；application window 与 widget board window 只是内容不同；
- sidebar 的 WindowGroup 可以 host 一个 editor window（file placement 是 workbench 的记录，group 只列出它，`owned: false`）；board window 的身份投影落在这个 group 上（region 有 editor group 时），否则 `mapWindow` 是 no-op；
- window group 的 tab 是 window，不是 widget；
- application window 内部可以有 app-owned view / section，但 MVP 不承载可重组的 widget board；
- widget window 由 board host app 打开；board composition 可改，window identity 不变。

### Widget board

Board 是一个 **window 的内容**，不是布局面，也不是 window group。

```text
window group → window → content(board) → widget
```

- board 是 **widget board window** 的内容；board window 可以在 stage / sidebar / panel；
- sidebar / panel 的内容区域是 window group，里面承载 board window；dock 的 rail 是 launcher，不是内容面；`BoardWindow` 是那个 window，`BoardWindowAdapter` 用 `WindowGroupModel` 承载它和可选的额外 window；
- board window 的记录由 window group 投影进 frame；board 的 widget 顺序 / 行高 / 折叠归 board 自己的 store，并随 workspace 持久化；
- board 负责 widget placement、布局、active widget；
- board 拥有自己的 **LayoutRoot**，和 frame 的外层 layout 共用同一套 LayoutEngine；
- board 可以容纳来自不同 source 的 widget；board owner 不是 widget source owner；
- board 不定义 widget 的内容语义；widget 是 board 里的 item，不是 window。

### Widget

Widget 是可组合的内容单元。

```ts
interface WidgetDefinition {
  id: string;
  title: string;
  icon?: string;
  source: "vscode" | "dsh" | "core";
  hostKind: "view-pane" | "react" | "webview";
  defaultBoard?: string;
  multiplicity: "single" | "multi";
  actions?: readonly ActionRef[];
}

interface WidgetPlacement {
  widgetId: string;
  boardId: string;
  order: number;
  size?: WidgetSize;
}
```

- widget 可在兼容 board 之间移动；placement 改、source 不变；
- `defaultBoard` 只是默认落点，不是所有权；
- 默认 move-only；copy 需要显式能力；
- 单 view board 就是 `placements.length === 1`，不是特殊类型；
- widget 不直接进入 window group，也不成为 tab；
- frame 用记录判别 window / widget：file view → window，catalogue 的 view source → widget；board window 是一条 `kind: "window"` 记录，带 `boardId` 指向它的 board content。

#### 注册面：descriptor + registry + host factory

Widget 的注册面是 typed descriptor + registry + host factory，不是通用 CRD：

```ts
interface WidgetHostFactory {
  create(definition: WidgetDefinition, options?: { move?: MoveIntent }): WidgetHost;
}

interface WidgetRegistry {
  register(definition: WidgetDefinition): Disposable;
  lookup(id: string): WidgetDefinition | undefined;
}
```

配套对象：

- **`BoardBinding`**：VS Code `ViewContainer` 的 context / actions / focus / drag-drop；挂到 board，不拥有 widget；
- **`Catalogue`**：active widget / window 条目进出；source 适配器生产；
- **`WidgetHost`**：mount / release / focus 的运行时边界；
- **`WidgetPlacement`**：widget → board 的 placement。

不需要：

- `ResourceEnvelope` / `apiVersion` / `kind` / `metadata`；
- `ViewGroupDefinition` / `ViewGroupResource`；
- `ResourceMaterializer` / phase / generation / dependency waiter；
- `ViewDefinition` / `ViewResource` 的通用 materialization。

理由：

- board 是 window content，不是来源声明的资源；board 的 layout root 是布局实现；
- widget 已经有 `id` / `source` / `hostKind` / factory，不需要再包一层 CRD；
- 当前只有 VS Code / DSH 两个来源，`source` 字段足够；`prac.view` / DSH slot 已经处理动态进出；
- 现有 `ResourceMaterializer` 没有生产消费者；`VscodeGroupHost` 已经承担实际的 add / remove / reorder / binding / dispose。

如果将来出现第三方 JSON / YAML 声明 UI、远程 composition 或多版本资源，再在 descriptor 之上加一层薄 envelope；现在不做。

### 关系约束

- window 可以没有 board（application window）；board 本身就是一个 window；
- widget 可以没有 board（未放置的 definition / instance）；widget 不单独成为 window；
- board window 可以在 stage / sidebar / panel；位置不改变它是 window；
- window group 只包含 window；
- window owner（appId）与 widget source 是两件事；
- app 定义默认 composition，用户移动后 composition 是运行期状态。

## 布局与内容根

### 几何与 Space

```text
Frame shell（frame 级）
  dock / sidebar / panel / chrome
  stage
    └─ Space（stage 的虚拟桌面）
         └─ space root
              split / grid / region
                   └─ ContentRoot
```

**region 是几何槽位，内容根是 ContentRoot**：

| region | content root | 归属 |
|---|---|---|
| stage 的 grid cell | **window group**：window 集合、tab strip、active window | 当前 Space |
| primarySidebar / secondarySidebar / panel | **window group**：承载 board window；board window 的内容是 widget board | frame 级，跨 Space |
| opaque host | 外部内容 | owner 决定 |

- **Space 是 stage 的虚拟桌面**：拥有一个 `space root`，不是 layout root，也不是 project folder；
- **sidebar / panel / dock 是 frame 级，和 stage 平级**：不随 Space 切换；只有 stage 的 `space root` 切换；
- **frame shell 有自己的 `frame root`**：dock / sidebar / panel / stage 占位；
- **board root** 在 board window 的 content 里，随 window 所在位置决定 scope（stage 的 board window 属于 Space；sidebar/panel 的属于 frame）。

### LayoutRoot

外层的 window group 和 board window 的内容都需要 split / grid / region / stack / sash / resize / persistence。它们不是多套 layout 实现，而是同一个 **LayoutEngine** 的三个 root：

```ts
interface LayoutRoot {
  id: string;
  kind: "frame" | "space" | "board";
  tree: LayoutNode;
  active?: string;
}
```

- `frame root` 是 workbench shell：dock / sidebar / panel / stage 占位；frame 级，不随 Space 切换；
- `space root` 是一个 Space 的 stage 树：stage 的虚拟桌面；每个 Space 一个，切换 Space 就是切它；
- `board root` 是 board window 的 content：item 是 widget；
- `frame root` / `space root` 的 item 是 window（经 window group），`board root` 的 item 是 widget；
- split / grid / region / stack / sash / resize / persistence 由同一个引擎提供；
- root 只决定 owner / item 边界，不复制算法。

### FrameState / SpaceState

- `FrameState` 是 frame shell：`tree`（stage 占位）、shell views、`viewportWidth/Height`、`catalogueVersion`、`activePanelId`；
- `SpaceState` 是一个 Space 的 stage：`tree` + stage views；
- renderer 仍消费一个 `LayoutState`；`createComposedStore` 把两者 compose 成它，把更新 split 回两个 owner；
- 持久化键分开：`prac-frame/v1/<workspace>` 与 `prac-space/v1/<workspace>/<space-id>`；切 Space 只切 stage store；
- `activeSpaceId` 属于 frame 级的 spaces registry（`prac-spaces/v1` 的 `{ spaces, activeId }`），不塞进 `LayoutState`；reload 恢复上次 active Space；
- `FrameState` 是 viewport / catalogueVersion / activePanelId 的唯一 owner；stage 更新不会重置它们。

### ContentRoot、Group 与 host

`ContentRoot` 是 region 的内容根，不是 content 本身：

```ts
interface ContentRoot<TContent> {
  kind: string;
  content: TContent;
  readonly host?: ContentHost;
  dispose(): void;
}
```

- `content` 可以是 `ContentGroup`（tabs / stack）、单个 `ContentItem`、`LayoutRoot`（board / 嵌套布局）或 opaque host；
- **`ContentRoot` 不假设下面是 group**；`ContentGroup` 只是 content 的一种；
- `WindowGroup` 是 `ContentGroup<Window>`；`Window` 是 `ContentItem<WindowContent>`；
- 单 item 的 window 内容不需要伪 group；board 作为 `LayoutRoot` 也不需要伪 group；
- host 是可选的内容端点：内容自己 mount，root 或 group item 可以持有它；模型不持有 DOM。

`ContentMount` 已删除；host 只剩 `ContentHost` 一条路径：

```ts
interface ContentHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus?(): void;
}
```

`ContentRoot` 可选持有 `ContentHost`；group item 各自持有 host；renderer 直接 mount，不再有 `attach` / `detach` 的第二套 API。

`RegionContent` 当前是：

```ts
type RegionContent<TGroup = unknown> =
  Omit<ContentRoot<TGroup>, "content"> & { readonly group?: TGroup };

type GroupRegionContent<TGroup> =
  RegionContent<TGroup> & { readonly group: TGroup };
```

- `RegionContent` 是 region 的内容端口；非 group root 不需要伪 group；
- `GroupRegionContent` 是 group 版本；
- `RegionContentRegistry` 只负责 “kind → factory”，不是核心抽象；
- `RegionBinding` 是当前唯一的绑定记录：

```ts
interface RegionBinding {
  readonly content: GroupRegionContent<FrameWindowGroup>;
  readonly group: FrameWindowGroup; // getter，派生自 content.group
  readonly regionId: string;
  readonly bridge: WindowGroupLayoutBridge;
}
```

- `FrameSurface` / `FrameGroup` / `SurfaceRegistry` 已删除；
- group 通过 `content.group` 取得，不再重复存储；
- registry 仍保留，因为插件需要按 kind 动态创建内容。

### Board hole 与跨 root

窗口是 **content / lifecycle / focus / theme 的边界**，但不是 layout 黑盒。board 的 layout root 以 **hole** 的形式对 frame 的 layout engine 可见：

```text
frame layout
  └─ window
       └─ content
            └─ board root（hole）
                 ├─ widget
                 ├─ widget
                 └─ split / stack
```

hole 的含义：

- board 仍是 window content，有 window identity / lifecycle / active；
- board 的 layout root 参与 frame 的 hit-test、拖拽、尺寸与 split；
- 视觉裁剪、focus、theme、active window 仍由 window 边界负责；
- 洞是 layout 层的洞，不是绕过 window 的内容容器。

跨 root 的拖拽语义：

- 同一 board root 内：移动、split、merge、reorder 正常；
- 跨 board / 跨 window：允许 **move widget**，source / target board identity 不变；
- 跨 window 不直接做 split / combine：split 的结果必须属于一个 board window；正确语义是“move 到 target board，再在 target board 内 split”；
- 不允许在 frame 层把两个 window 的 widget 拼成一个跨 window region。

**split / combine 的准确含义**：

- **split**：在**同一个 board root 内**引入一个 split node，让两个 widget 成为它的子 region（左右 / 上下 / grid cell）；split node 的父 root 必须是这个 board；
- **combine**：在**同一个 board root 内**把两个 region / 两个 stack 行 / 两个 grid cell 合成一个 region（stack / tabs / merge cell），widget 的 board 归属不变；
- **跨 board split / combine 不是布局操作**：split / combine node 只能属于一个 board root；跨 board 的正确操作是 **move widget 到 target board，再在 target board 内 split / combine**；
- 如果要把两个 board 的 widgets 合到一个布局里，必须先做 **board merge / window merge**（显式操作，改变 board / window 归属），而不是产生一个跨两个 window 的 split node。

### Window content 与 board root

`WindowContent` 是判别联合，board root 只属于 board：

```ts
type WindowContent =
  | { kind: "editor"; host: ContentHost }
  | { kind: "chat"; host: ContentHost }
  | { kind: "board"; board: BoardContent }; // BoardContent owns a LayoutRoot
```

- editor / chat 是 **opaque content host**：没有 prac layout root，不参与 widget 拖拽；
- 它们的 placement / split 由**外层 frame layout** 负责；window group 仍然只包含 window；
- VS Code 的 split editor 是**新的 editor group = 新的 window group**，不是 editor window 内部的嵌套 layout；
- chat / editor 不是 widget，不进入 board；widget 的拖动 / 拆分 / 组合与它们无关；
- board root 不是所有 window 的通用要求；只有 board content 需要内层 layout；
- 如果将来某个 app-owned content 需要内部可调分区，它可以自己使用 LayoutEngine，但那是 app content 的实现，不是 frame 强制给每个 window 的 layout。

### Placement 与 active

- **placement 有两条边**：
  - `window → window group`；
  - `widget → board root`；
- **active 分两级**：
  - window group 的 active window；
  - board 的 active widget；
- **widget window** 是 window 的一种，内容是一个 board；不是 region；
- **board 不是 frame 的 ContentRoot**：它是 window content；承载 board window 的 ContentRoot 是 window group。

## 映射

### VS Code

| VS Code | prac |
|---|---|
| editor input（文件 / diff / custom editor / webview） | **application window**（editor app） |
| `ViewContainer`（Explorer / SCM / GitLens / Run / Problems / Output / Terminal） | **widget board window**（sidebar / panel / stage）；board 是 window |
| `ViewDescriptor`（Folders / Timeline / Outline / Changes…） | **widget**，带默认 board hint，可移动 |
| 单 view container | **一个 widget 的 board**，不是特殊 app |
| editor group | window group 的 adapter runtime（`IEditorGroupView`） |
| 菜单 / 命令 / action | action model；在 window tab strip / widget header / frame chrome 呈现 |

### DSH

| DSH | prac |
|---|---|
| `main` keyed entry（conversation / plugin manager / task manager） | **application window** |
| `sidebar` / `rightbar` | **widget board window**（sidebar / panel） |
| 内部 slot（conversation.* / sidebar.* / settings.* / plugins.*） | **widget / section**，属于对应 app window / board |
| `shell.overlay` / toast / quota notice / `shell.leading` | **frame overlay / chrome**；不是 widget / window |

### 归属规则

- application window 的内容归 app；
- widget 的内容归 source；
- window group / board 归 frame；
- window owner app 仍可容纳其他 source 的 widget（如果 board 接受 foreign widget）；
- move widget 只改 widget placement；move window 只改 window placement；两者不混淆。

## Chrome、actions 与隔离

### Chrome

- window group tab strip 由 frame 画；tab 是 window；
- **actions 在 window group tab strip 右端**；adapter 把 active window 的 actions 解析成 resolved action model（editor window 用 `MenuId.EditorTitle`，chat / board 由各自 content 提供），frame 渲染并回调；group header 不再画 actions；
- editor application window 的 breadcrumbs 在 pane / window chrome 内，不属于 group tab strip；
- container / widget board 的 widget header / actions 归 widget / board；
- 非 editor widget 没有 breadcrumbs；pane 自己提供 breadcrumbs 时不重复；
- overlay / toast / command palette 走 frame float layer。

### 隔离

- window 是**外层 containment / stacking / theme / focus** 边界；
- 同源 window / board 可以共享 window root；
- **VS Code + DSH 混排默认保留 per-widget root / source-scoped 子树**：frame 的 `:host` / `:host-context`、VS Code 的 `.monaco-workbench` 语境、DSH 的 root 作用域都依赖它；
- webview / iframe / opaque widget 使用自己的 browsing context / host；
- 跨 window 的 overlay 走 frame float layer；widget 自己 DOM 内的 overlay 留在 window 内。

## 包与依赖

UI 按**层**拆包，不按 window / board 领域拆；每一层都能独立使用：

| 包 | 职责 | 依赖 |
|---|---|---|
| `prac-ui-kit-layout` | **L0**：纯 geometry / tree / allocation / grid；无 DSH / React / DOM / 内容根；无 view / viewGroup（source adapter 词汇） | 无 |
| `prac-ui-kit-content` | **L1**（partial）：`ContentRoot` / `ContentGroup` / `ContentItem` / `ContentHost`、`PlacementRecord` / `LayoutState`、`LayoutStore` / `useLayout`、switching / snapshot / workspace / isolation、chrome / renderModel / `LayoutRenderer` / tabs / stack / sash / containerBar / grid / resize / drag / isolation、generic `model`；已出 `./content` / `./placement` / `./model` / `./store` / `./react` / `./renderer` / `./grid` 等 subpath；无 window / space / frame shell / DSH；`layoutDrop` / `layoutActions` / `layoutContentHost` 是泛型 L2 primitive，留在 workbench | `prac-ui-kit-layout` |
| `prac-ui-kit-workbench` | **L2**：Space（stage 虚拟桌面）、Window / WindowGroup、Board / Widget、frame shell（sidebar / panel / dock）、`RegionContent` / `RegionBinding`、frame state / board layout；不重新导出 content 的 renderer / chrome / tabs / store hook；无 DSH、无 prac 内容种类 / catalogue / 默认 arrangement | `prac-ui-kit-layout`、`prac-ui-kit-content` |
| `prac-client-ui-frame` | **核心 DSH host**：持久化 store、DSH slot catalogue、`SlotMap` / `Context` 契约（`./client` 的 types 入口）、slot 声明、`ctx.pracFrame` / `ctx.pracSpaces` / `ctx.layout`、theme presenter；同时注册 `window-group` surface 工厂；window / window-group 小模型也在本包 | `prac-ui-kit-workbench`、DSH store / renderer / slots |
| `prac-client-ui-widget` | **prac 的 board / widget 适配器**：`BoardWindow` / `BoardWindowAdapter` / `BoardContent`、widget registry、DSH / VS Code widget source；通用 `Board` / `Widget` 在 kit | `prac-ui-kit-workbench` |
| `prac-client-ui-workbench` | 默认 Space / window / board 放置、arrangement、recall、持久化 defaults、open policy | 核心 + adapters |
| `prac-client-ui-dsh` | DSH slot → application window / widget board window / widget / action | 核心、DSH slots |
| `prac-client-vscode-host` | VS Code embed bridge / face / catalogue | 核心 |
| `prac-client-ui-vscode-editor` | VS Code editor input → application window，`EditorWindow` + `EditorPane` | `prac-client-ui-frame`、`prac-client-vscode-host` |
| feature 包 | changed-files、review 等 | 核心 / adapter |
| `bundle/web-app` | **composition root only** | 所有包 |

依赖方向：

```text
prac-ui-kit-layout            L0 pure layout
   ↑
prac-ui-kit-content         L1 content (window 内容可独立使用)
   ↑
prac-ui-kit-workbench          L2 Space / Window / Board / Widget / frame shell
   ↑
prac-client-ui-frame (DSH host + window-group adapter)
   ↑                         ↑
prac-client-ui-widget     prac-client-vscode-host / ui-vscode-editor
   ↑                         ↑
prac-client-ui-workbench / feature adapters
   ↑
bundle/web-app
```

L1 的 subpath：

```text
prac-ui-kit-content/model    ContentRoot / ContentGroup / ContentItem / placement / state（无 React / DOM）
prac-ui-kit-content/react    renderer / React mount / chrome
```

约束：

- `prac-ui-kit-*` 是库：不得 import `prac-client-*` 或 bundle（`pnpm verify:packages` 守）；
- `prac-ui-kit-content` 不得 import window / space / frame shell；它是 L1，window 内容可以只用它；
- `prac-ui-kit-workbench` 不得 import DSH / prac 内容种类 / catalogue / 默认 arrangement；window / board / widget / space 的**通用**模型在这里；
- `prac-client-ui-frame` 只做 DSH host + window-group adapter：不导出 `./lib`，不 import board / vscode / dsh 的布局实现；
- `prac-client-ui-widget` 是 board content 适配器，不拥有通用模型；DSH 契约只从 `prac-client-ui-frame/client` 的 types 取（type-only）；
- `prac-client-ui-window` 已并入 `prac-client-ui-frame`；`WindowGroupAdapter` / `Window` / `WindowGroup` 小模型、`window-group` factory 都在 frame 插件里；`pracWindows` 服务已删除。
- adapters 只做来源翻译，不拥有 frame / window / widget 机制；
- **bundle 是叶子**：其它包不能 import bundle；bundle 内不出现默认布局、默认 placement、业务 action、DSH / VS Code 映射；只做包选择、启动顺序、provider / 根组件装配；
- `prac-client-ui-workbench` 承接 arrangement / recall / 默认落位 / open policy，不是 bundle 的业务逻辑；
- `prac-ui-kit-content` 已抽出 content protocols / placement / store / switching / snapshot / isolation / chrome / renderModel / `LayoutRenderer` / tabs / stack / sash / containerBar / grid / resize / drag / containerChrome / chromeIntents / generic `model`；`Window` 实现 `ContentItem`、`WindowGroup` 实现 `ContentGroup`（`itemId` 已进入 placement）；workbench 的 `model` 只保留 defaultTree / window-widget record factory / prune，`layoutDrop` / `layoutActions` / `layoutContentHost` 是泛型 L2 primitive。
- `Surface` / `FrameSurface` / `FrameGroup` / `SurfaceRegistry` 已删除，收敛为 `RegionContent` / `GroupRegionContent` / `RegionContentRegistry` / `RegionBinding`；`ContentMount` 已删除，host 只剩 `ContentHost`。
- `prac-client-ui-window` 已删除；`prac-client-ui-widget` 仍含 board 具体模型。
- `FrameState` / `SpaceState` 已拆（`prac-frame/v1` + `prac-space/v1`），renderer 通过 composed state 消费。

`prac-client-ui-frame` 是真正的 DSH 插件行：`dsh.client` + `./client` loader artifact，`./client` 的 `types` 条件做 DSH 契约的 type-only 入口；`./lib` 已删除，共享的 model / renderer / chrome 在 DSH-free 的 `prac-ui-kit-workbench`。服务面：

```text
ctx.pracFrame        // geometry / region / dock rail / sidebar / panel
ctx.pracApplications // app registry / launch
ctx.pracWidgets      // board / widget / placement（由 ui-widget 提供）
ctx.layout           // DSH compat shim（放 ui-frame）
```

`ctx.pracLayout` 只作为迁移期兼容别名，最终删除。

## 术语

- **Application**：启动身份；window 由 app 打开。
- **Frame shell**：workbench 外壳；dock / sidebar / panel / chrome 与 stage 平级。
- **Stage**：中央工作区；承载当前 Space。
- **Space**：stage 的虚拟桌面；拥有一个 `space root`；不是 layout root、store、project folder。
- **LayoutRoot**：一棵树 + owner kind（`frame` / `space` / `board`）。
- **ContentRoot**：region 的内容根；`content` 可以是 group / item / layout root / opaque host。
- **ContentHost**：内容端点；`mount` / `release` / `focus?`。
- **Dock**：侧区的 rail + launcher；内容面是 sidebar。
- **Sidebar**：内容区域，承载 widget board window；不是 dock。
- **Window**：app 的实例；application window 或 widget window。
- **Widget board**：一种 **window 的内容**，承载 widget 的布局；不是 app / window group，也不是 region。
- **Widget**：可组合内容；不是 window，也不直接进 window group。
- **Container**：board 的早期名字；不再是独立对象。
- **View / ViewGroup**：已退役；view 是 source adapter 自己的词汇，不是 prac 产品对象。
- **Editor group**：window group 在 VS Code adapter 里的 runtime counterpart，不是 prac UI 层。
- **Editor window**：editor application window 的简称；adapter 侧每个 window 的表示见 10-07。

## Decisions

### 产品对象

- tile mode 是当前唯一模式；free window 当前不考虑（2026-10-30 确认）。
- Application 是启动身份；window 由 app 打开；没有无主 window。
- App / Window / Widget board / Widget 是四类对象及其关系，不是线性父子链。
- Window 两种：application window 与 widget window；每个 window 在 adapter 侧有 1:1 `EditorInput` 投影（含 chat / widget），window 本身是 frame 权威。
- Widget 可在 board 之间移动；placement 改、source 不变。
- board window 可以在 stage / sidebar / panel；位置不改变它是 window；window group 只包含 window。

### 布局与 Space

- Space 是 stage 的虚拟桌面；拥有一个 `space root`，不是 layout root / store / project folder；sidebar / panel / dock 是 frame 级，和 stage 平级。
- `LayoutRoot` 的 kind 是 `"frame" | "space" | "board"`，不用 `"stage"`。
- stage cell 的 content root 是 window group（属于当前 Space）；panel / sidebar 的 content root 是承载 board window 的 window group（frame 级，不随 Space 切换）。
- `ContentRoot` 不假设 `group`；`ContentGroup` 只是 content 的一种；挂载点是 `ContentHost`，模型不持有 DOM。
- Frame shell 与 Space stage 分开持久化：`prac-frame/v1/<workspace>` + `prac-space/v1/<workspace>/<space-id>`；renderer 用 composed state，切换 Space 只切 stage store。
- frame 拥有 window order / active / tab strip；editor group 是投影。
- window 外层隔离；混排保留 per-widget root。

### 框架与包

- kit 的 L2 包名从 `prac-ui-kit-frame` 改为 `prac-ui-kit-workbench`：它承载 Space / Window / Board / Widget / frame shell，不只是 frame。
- `prac-client-ui-frame` 不改名为 `prac-client-ui-shell`；shell 容易与 terminal 混淆。
- client 插件不合并成一个：保留 `prac-client-ui-frame`、`prac-client-ui-widget`、`prac-client-ui-workbench`；`prac-client-ui-window` 已并入 `prac-client-ui-frame`，`pracWindows` 服务已删除。
- `prac-client-ui-widget` 保持独立：board 是可选内容能力，且带 zustand / immer；不合并进 core。
- `prac-client-ui-workbench` 保持独立：它是 arrangement / 产品策略，不是基础设施。
- 模型是 `Region → ContentRoot → optional Group → Items → Renderer → Host`；`RegionContent` 是端口/组合，不是一层；`RegionContentRegistry` 只做 kind → factory，`RegionBinding` 是唯一绑定记录。
- group 是可选分支；单个 editor / 终端 / plain panel 可以直接是 `ContentRoot` 的 content，不需要伪 group。
- host 只保留一条挂载路径：`ContentHost`；`ContentMount` 已删除。
- Board 是 window 的 content，不是 group/surface；Widget 是 board 的 item。`BoardWindow` 实现 `Window` / `ContentItem`，`BoardWindowAdapter` 只是 L3 adapter。
- UI 框架按 L0 layout / L1 content / L2 frame / L3 prac 分层；每层都能独立使用，L1 可独立用于 window 内容。
- window / board / widget / space 是通用 UI 原语，属于 kit；prac 只提供内容种类、来源、catalogue、默认 arrangement、faces。
- 拆包按层，不按 window / board 领域；`prac-ui-kit-content`（L1）已立包，先抽出 content protocols / placement / store / snapshot / isolation；renderer / model 随后迁入。
- 包名保持 `prac-ui-kit-*`：暂不引入独立的 `@prac-ui` scope；等框架真的要对外发布时再讨论。
- `defaultTree` 仍是 kit 的通用默认 topology，但 `createFrameState(tree?)` / `createSpaceState(stage?)` / `createFrameStore(..., tree?)` / `createSpaceStore(..., stage?)` 允许 app 注入；prac 的默认 arrangement 不必改 kit。`layoutDrop` / `layoutActions` / `layoutContentHost` 是泛型 L2 primitive，留在 frame。
- kit 的 “view” 词汇已清：`ItemRecord` / `ItemFlags` / `ItemKind` / `itemId` / `items`；`prac.view` 等 source slot 留在 plugin。持久化不升 v2，旧 `views` 字段由 store heal 时读成 `items`。
- plugin face 也改用 `Item*`：`listItems` / `activeItem` / `splitItem` / `setItemKind` / `setItemBoard` / `onDidRequestCloseItem`；source adapter 的 `viewId` 仍保留。
- 包入口按层：`prac-ui-kit-*` 是库，只出 `.`，且不 import DSH；`prac-client-*` 是 DSH 插件行，出 `./client`。`ui-frame` 的 `./client` 出 loader artifact，其 `types` 条件承载 DSH 契约类型；root 是 host 半。
- 包划分与 bundle 规则见「包与依赖」。

### 映射、Chrome 与隔离

- VS Code editor input → application window；ViewContainer → board；ViewDescriptor → widget。
- DSH `main` → application window；`sidebar` / `rightbar` → board；内部 slot → widget；shell → frame。
- breadcrumbs 属于 editor window；actions 在 window group tab strip 右端，frame 渲染 resolved action model；`prac.viewActions` 不复用作 editor action model。
- Space 状态按 project folder（workspace）隔离；对齐 VS Code 的 workspace storage。
- Dock = rail/launcher；不是 region / ContentRoot。Sidebar / panel 是内容区域，承载 widget board window；不与 stage 同类。

## Open questions

### 产品与映射

1. stage widget window 的 host app 是否 `workbench.widgets`。
2. application window 内是否允许 widget board slot（MVP 不允许）。
3. widget copy 语义；哪些 widget 允许多实例。
4. 空 board / 空 widget window 的关闭策略。
5. board 的 widget 顺序 / 尺寸持久化范围（Space / window / board）。
6. window action model 的字段 / overflow / 更新时机（ownership 已定：适配器解析，frame 渲染；见 10-07 §8）。
7. `EditorPaneHost` 与 group 的职责切分（不采用 group 级 `EditorPanes` 过渡复用）；见 10-07 §3.1。
8. extension `tabGroups` API 如何映射 / 隔离。
9. 同源 window / board 合并 shadow root 的迁移条件。
10. persistence schema 迁移与 service facade。
11. DSH 内部 slot 作为 widget 的可移动性边界。

### 分层与打包

1. L1 的 `LayoutRoot` 是否加 `"content"` kind，还是直接用 `LayoutState` 的 tree。
2. L2 的默认模型 vs 适配器：Window / Board / Widget 的默认实现放 kit 还是 `prac-client-ui-widget`。
3. `RegionContentRegistry` 是否还需要作为独立类，还是收成一个 Map；不影响 host 路径。

## Validation

- **对象关系**：app 打开 window；window 可不带 board；board 可不带 window；widget 可未放置。
- **VS Code 映射**：editor input → application window；ViewContainer → board；ViewDescriptor → widget；单 view container = 一 widget board。
- **DSH 映射**：`main` → application window；sidebar/rightbar → board；内部 slot → widget；overlay 不进 window。
- **窗口组**：tab 是 window；widget 不是 tab；active window 与 active widget 分两级。
- **widget 重组**：Timeline 从 Explorer board 移到 right sidebar board / stage widget window；source 不变。
- **chrome**：breadcrumbs 不挤 actions；actions 在 tab strip 右端；container/widget actions 在各自 header。
- **isolation**：混排 window 的 CSS / `:host` / overlay / focus 不互相穿透。
- **package gate**：不存在独立的 `prac-client-ui-window`；`prac-client-ui-frame` 不 import `prac-client-ui-widget`；kit 不 import client；bundle 是叶子且无业务逻辑。
- **L1 独立**：只凭 `prac-ui-kit-layout` + `prac-ui-kit-content`，就能在 window 内容里渲染 tabs / stack / sash / grid，不创建 window / space / frame。
- **Space / frame scope**：切 Space 只换 stage 的 `space root`；sidebar / panel / dock 保持；reload 后各自恢复。
- **LayoutRoot**：`frame` / `space` / `board` 三类 root 的 item 词汇与边界清楚，不复制算法。
- **ContentRoot**：single item / group / layout / opaque 都能作为 content，不需要伪 group；group 是可选分支，不是必经层。
- **host**：只有一条挂载路径；model-only root 不强制 host，group item 各自持有 host。
- **Frame / Space store**：切 Space 只换 stage store；sidebar / panel 的 views 留在 frame store；reload 后 active Space、frame、space 各自恢复。
- **persistence keys**：`prac-frame/v1`、`prac-space/v1`、`prac-board/v1` 都存在。
- **生命周期**：关最后一个 widget 不误关 window group / region；空 board / 空 window 按规则处理。

## Related

- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：editor application window / pane host。
- [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)：VS Code adaptor。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：surface / isolation。
- [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)：frame / grid。
- [2026-10-23-ui-scheme.md](2026-10-23-ui-scheme.md)：产品设计。
- [2026-10-27-ui-user-stories.md](2026-10-27-ui-user-stories.md)：用户故事 / 验收。
