---
status: in-progress
---

# Agent Note: UI framework — Application / Window / Widget / Board

> 这是 prac UI 的组合模型 umbrella。editor window 的实现边界见 [2026-10-07-editor-host.md](2026-10-07-editor-host.md)；VS Code adaptor 见 [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)；隔离见 [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)；几何 / grid 契约见 [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)。产品设计见 [2026-10-23-ui-scheme.md](../proposed/2026-10-23-ui-scheme.md)。

## Summary

prac 的 UI 由四类对象组成：

```text
Application（启动身份）
Window（app 打开的实例）
Widget board（布局面）
Widget（可组合内容）
```

它们不是线性父子链：

```text
Application --opens(1..N)--> Window
Window --hosts(0..1)--> Widget board
Dock / Panel --hosts(0..N)--> Widget board
Widget board --places(0..N)--> Widget
Widget --source--> provider
Widget --placement--> Widget board
Window group --contains--> Window
```

frame 拥有布局拓扑、surface、window group / window、active、tab strip 与 chrome 边界；来源拥有内容实现；adapter 在 prac 与 VS Code / DSH 之间翻译；bundle 只做 composition root。

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

## 1. 对象

### 1.1 Application

Application 是**启动身份**，不是内容容器。

- 定义可打开的 window kind、single / multi、默认 placement、默认 composition、launcher / command；
- **window 只能由 app 打开**；
- app 可以是 content app（editor / chat / terminal / browser）或 board host（widget window 的 host）；
- app 不拥有 widget 的实现；widget 的 source 独立。

### 1.2 Window

Window 是 app 打开的实例，有 placement、生命周期、active。

| window kind | 内容 | 例子 |
|---|---|---|
| **application window** | app-owned 内容 | editor（一个文件）、chat、diff、terminal、browser、settings |
| **widget window** | 一个 widget board | stage 上的 Explorer board、单 Timeline board |

- **所有 stage window 都是 editor input / EditorWindow 形态**；application window 与 widget window 只是内容不同；
- window group 的 tab 是 window，不是 widget；
- application window 内部可以有 app-owned view / section，但 MVP 不承载可重组的 widget board；
- widget window 由 board host app 打开；board composition 可改，window identity 不变。

### 1.3 Widget

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
- widget 不直接进入 window group，也不成为 tab。

### 1.4 Widget board

Board 是摆放 widget 的布局面，不是 app，也不是 window 类型。

- panel / dock 可以直接是 board；
- stage 上的 board 由 **widget window** 承载；
- board 负责 widget placement、布局、active widget；
- board 可以容纳来自不同 source 的 widget；board owner 不是 widget source owner；
- board 不定义 widget 的内容语义。

### 1.5 Widget registration（无 CRD）

Widget 的注册面是 **typed descriptor + registry + host factory**，不是通用 CRD：

```ts
interface WidgetDefinition {
  id: string;
  source: "vscode" | "dsh" | "core";
  hostKind: "view-pane" | "react" | "webview";
  title: string;
  icon?: string;
  defaultBoard?: string;
  multiplicity: "single" | "multi";
  actions?: readonly ActionRef[];
}

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
- **`WidgetPlacement`**：widget → board 的 placement；见 §1.3。

不需要：

- `ResourceEnvelope` / `apiVersion` / `kind` / `metadata`；
- `ViewGroupDefinition` / `ViewGroupResource`；
- `ResourceMaterializer` / phase / generation / dependency waiter；
- `ViewDefinition` / `ViewResource` 的通用 materialization。

理由：

- board 是 frame 的 surface，不是来源声明的资源；board 的内容组只是布局实现；
- widget 已经有 `id` / `source` / `hostKind` / factory，不需要再包一层 CRD；
- 当前只有 VS Code / DSH 两个来源，`source` 字段足够；`prac.view` / DSH slot 已经处理动态进出；
- 现有 `ResourceMaterializer` 没有生产消费者；`VscodeGroupHost` 已经承担实际的 add / remove / reorder / binding / dispose。

如果将来出现第三方 JSON / YAML 声明 UI、远程 composition 或多版本资源，再在 descriptor 之上加一层薄 envelope；现在不做。

### 1.6 关系约束

- window 可以没有 board（application window）；
- board 可以没有 window（panel / dock）；
- widget 可以没有 board（未放置的 definition / instance）；
- window group 只包含 window；
- window owner（appId）与 widget source 是两件事；
- app 定义默认 composition，用户移动后 composition 是运行期状态。

## 2. 布局与 surface

几何层仍然是：

```text
Space
  split / grid / region
```

**region 是几何槽位，内容根是 surface**：

| region | surface |
|---|---|
| stage 的 grid cell | **window group**：window 集合、tab strip、active window |
| primarySidebar / secondarySidebar / panel | **widget board**：widget 集合、active widget |
| opaque host | 外部内容 |

- **geometry 不因为 widget model 改变**：split / grid / region / sash / track / resize 契约不变；
- **placement 拆成两条边**：
  - `window → window group`；
  - `widget → widget board`；
- **active 分两级**：
  - window group 的 active window；
  - board 的 active widget；
- **widget window** 是 window 的一种，内容是一个 board；不是 region。

## 3. 映射

### 3.1 VS Code

| VS Code | prac |
|---|---|
| editor input（文件 / diff / custom editor / webview） | **application window**（editor app） |
| `ViewContainer`（Explorer / SCM / GitLens / Run / Problems / Output / Terminal） | **widget board**（panel / dock）或 **widget window**（stage） |
| `ViewDescriptor`（Folders / Timeline / Outline / Changes…） | **widget**，带默认 board hint，可移动 |
| 单 view container | **一个 widget 的 board**，不是特殊 app |
| editor group | window group 的 adapter runtime（`IEditorGroupView`） |
| 菜单 / 命令 / action | action model；在 window tab strip / widget header / frame chrome 呈现 |

### 3.2 DSH

| DSH | prac |
|---|---|
| `main` keyed entry（conversation / plugin manager / task manager） | **application window** |
| `sidebar` / `rightbar` | **widget board**（panel / dock） |
| 内部 slot（conversation.* / sidebar.* / settings.* / plugins.*） | **widget / section**，属于对应 app window / board |
| `shell.overlay` / toast / quota notice / `shell.leading` | **frame overlay / chrome**；不是 widget / window |

### 3.3 归属规则

- application window 的内容归 app；
- widget 的内容归 source；
- window group / board 归 frame；
- window owner app 仍可容纳其他 source 的 widget（如果 board 接受 foreign widget）；
- move widget 只改 widget placement；move window 只改 window placement；两者不混淆。

## 4. Chrome、actions 与隔离

### 4.1 Chrome

- window group tab strip 由 frame 画；tab 是 window；
- **actions 在 window group tab strip 右端**；adapter 把 active editor input 的 `MenuId.EditorTitle` 解析成 resolved action model（command / toggle / submenu / enabled / group / order / icon），frame 渲染并回调；
- editor application window 的 breadcrumbs 在 pane / window chrome 内，不属于 group tab strip；
- container / widget board 的 widget header / actions 归 widget / board；
- 非 editor widget 没有 breadcrumbs；pane 自己提供 breadcrumbs 时不重复；
- overlay / toast / command palette 走 frame float layer。

### 4.2 隔离

- window 是**外层 containment / stacking / theme / focus** 边界；
- 同源 window / board 可以共享 window root；
- **VS Code + DSH 混排默认保留 per-widget root / source-scoped 子树**：frame 的 `:host` / `:host-context`、VS Code 的 `.monaco-workbench` 语境、DSH 的 root 作用域都依赖它；
- webview / iframe / opaque widget 使用自己的 browsing context / host；
- 跨 window 的 overlay 走 frame float layer；widget 自己 DOM 内的 overlay 留在 window 内。

## 5. Package architecture

prac 的 UI 不再集中在一个 `ui-layout` 包里。参照 DSH 的机制 / feature / adapter / bundle 划分：

| 包 | 职责 | 依赖 |
|---|---|---|
| `ui-frame` | Space、split / grid / region、dock / panel、sash、resize、surface / isolation、frame chrome、`ctx.layout` compat | DSH renderer / slots |
| `ui-window` | window、window group、window placement、active、tab strip、window actions、editor application window host | `ui-frame` |
| `ui-widget` | widget、board、widget placement、`prac.view` / `prac.viewActions`、widget host / chrome | `ui-frame` |
| `ui-workbench` | 默认 Space / window / board 放置、arrangement、recall、持久化 defaults、open policy | 核心 + adapters |
| `ui-dsh` | DSH slot → application window / widget board / widget / action | 核心、DSH slots |
| `ui-vscode-host` | VS Code embed bridge / face / catalogue | 核心 |
| `ui-vscode-views` | VS Code `ViewContainer` → board，`ViewPane` → widget | `ui-widget`、`ui-vscode-host` |
| `ui-vscode-editor` | VS Code editor input → application window，`EditorWindow` + `EditorPane` | `ui-window`、`ui-vscode-host` |
| feature 包 | changed-files、review 等 | 核心 / adapter |
| `bundle/web-app` | **composition root only** | 所有包 |

依赖方向：

```text
ui-frame
   ↑
ui-window     ui-widget
   ↑             ↑
ui-dsh / ui-vscode-* / feature

ui-dsh / ui-vscode-* / feature
   ↑
ui-workbench
   ↑
bundle/web-app
```

约束：

- `ui-frame` 只认 surface registry，不 import window / widget / vscode / dsh；
- `ui-window` 不 import `ui-widget`；widget window 的 board 通过 surface registry 获得；
- `ui-widget` 不 import `ui-window`；board 可以挂 panel / dock，也可以由 widget window 承载；
- adapters 只做来源翻译，不拥有 frame / window / widget 机制；
- **bundle 是叶子**：其它包不能 import bundle；bundle 内不出现默认布局、默认 placement、业务 action、DSH / VS Code 映射；只做包选择、启动顺序、provider / 根组件装配；
- `ui-workbench` 承接 arrangement / recall / 默认落位 / open policy，不是 bundle 的业务逻辑。

`ui-frame` 是真正的 DSH 插件行：`dsh.client` + `./client` loader artifact，`./lib` 提供类型 / 纯代码；`prac-client-ui-layout` 已删除。服务面：

```text
ctx.pracFrame        // geometry / region / dock / panel
ctx.pracApplications // app registry / launch
ctx.pracWindows      // window group / window / active
ctx.pracWidgets      // board / widget / placement
ctx.layout           // DSH compat shim（放 ui-frame）
```

`ctx.pracLayout` 只作为迁移期兼容别名，最终删除。

## 6. 术语

- **Application**：启动身份；window 由 app 打开；
- **Window**：app 的实例；application window 或 widget window；
- **Widget board**：摆放 widget 的布局面；不是 app / window 类型；
- **Widget**：可组合内容；不是 window，也不直接进 window group；
- **Container**：board 的早期名字；不再是独立对象；
- **View group**：board 的内部内容布局；不是 region 的唯一内容根；
- **Editor group**：window group 在 VS Code adapter 里的 runtime counterpart，不是 prac UI 层；
- **Editor window**：editor application window 的简称。

## 7. Decisions

- tile mode 是当前唯一模式；free-window 不做（2026-10-28）。
- Application 是启动身份；window 由 app 打开；没有无主 window。
- App / Window / Widget board / Widget 是四类对象及其关系，不是线性父子链。
- Window 两种：application window 与 widget window；所有 stage window 是 editor input / EditorWindow。
- Widget 可在 board 之间移动；placement 改、source 不变。
- stage cell 的 surface 是 window group；panel / dock 的 surface 是 widget board。
- VS Code editor input → application window；ViewContainer → board；ViewDescriptor → widget。
- DSH `main` → application window；`sidebar` / `rightbar` → board；内部 slot → widget；shell → frame。
- frame 拥有 window order / active / tab strip；editor group 是投影。
- breadcrumbs 属于 editor window；actions 在 window group tab strip 右端，frame 渲染 action model。
- window 外层隔离；混排保留 per-widget root。
- 包划分与 bundle 规则见 §5。

## 8. Open questions

1. stage widget window 的 host app 是否 `workbench.widgets`。
2. application window 内是否允许 widget board slot（MVP 不允许）。
3. widget copy 语义；哪些 widget 允许多实例。
4. 空 board / 空 widget window 的关闭策略。
5. board 的 widget 顺序 / 尺寸持久化范围（Space / window / board）。
6. actions 的 exact ownership / action model 字段 / overflow。
7. `EditorPaneHost` 从 `EditorPanes` 抽取还是过渡复用。
8. extension `tabGroups` API 如何映射 / 隔离。
9. 同源 window / board 合并 shadow root 的迁移条件。
10. 插件包名与 `./lib` / `./client` 双入口的稳定性。
11. persistence schema 迁移与 service facade。
12. DSH 内部 slot 作为 widget 的可移动性边界。

## 9. Validation

- **对象关系**：app 打开 window；window 可不带 board；board 可不带 window；widget 可未放置。
- **VS Code 映射**：editor input → application window；ViewContainer → board；ViewDescriptor → widget；单 view container = 一 widget board。
- **DSH 映射**：`main` → application window；sidebar/rightbar → board；内部 slot → widget；overlay 不进 window。
- **窗口组**：tab 是 window；widget 不是 tab；active window 与 active widget 分两级。
- **widget 重组**：Timeline 从 Explorer board 移到 right sidebar board / stage widget window；source 不变。
- **chrome**：breadcrumbs 不挤 actions；actions 在 tab strip 右端；container/widget actions 在各自 header。
- **isolation**：混排 window 的 CSS / `:host` / overlay / focus 不互相穿透。
- **package gate**：`ui-window` 不 import `ui-widget`；`ui-widget` 不 import `ui-window`；frame 不 import 来源；bundle 是叶子且无业务逻辑。
- **生命周期**：关最后一个 widget 不误关 window group / region；空 board / 空 window 按规则处理。

## 10. Related

- [2026-10-07-editor-host.md](2026-10-07-editor-host.md)：editor application window / pane host。
- [2026-10-17-vscode-host-architecture.md](2026-10-17-vscode-host-architecture.md)：VS Code adaptor。
- [2026-10-05-vscode-dsh-layout-boundary.md](2026-10-05-vscode-dsh-layout-boundary.md)：surface / isolation。
- [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)：frame / grid。
- [2026-10-23-ui-scheme.md](../proposed/2026-10-23-ui-scheme.md)：产品设计。
- [2026-10-27-ui-user-stories.md](../proposed/2026-10-27-ui-user-stories.md)：用户故事 / 验收。
