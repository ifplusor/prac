---
status: in-progress
---

# Agent Note: UI framework — 把两个生态的 UI 贡献收进一个组合体系

> **这是哪件工作**：prac 的 UI umbrella。目标只有一个：**VS Code 内置 / 扩展贡献的 UI，与 DSH 插件贡献的 UI，进入同一个目录、同一套摆放、同一套生命周期，能一起工作。**
> **关系**：贡献面与术语见 [docs/ui-surface-map.md](../../../docs/ui-surface-map.md)；VS Code adaptor 见 [2026-10-17-vscode-host-architecture.md](../in-progress/2026-10-17-vscode-host-architecture.md)；stack / grid 行为见 [2026-10-15-ui-layout-stack.md](../resolved/2026-10-15-ui-layout-stack.md) / [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md)。

## Summary

prac 拥有 UI 的组合模型，来源拥有内容与运行时。模型由三层构成：**布局拓扑**（split / grid / region）、**region 的内容根**（view group，mode 为 stack / select）、**view 的成员边**（placement）。container 是具名 view group，默认 stack；editor group 是 select view group + adapter binding，不是 prac 类型。frame 拥有布局、container 组织、group bar 与 host 边界；adapter 在 prac 模型与 VS Code / DSH 的来源模型之间做双向翻译。

## Motivation

prac 的 UI 不是从零写起的，也不是把 VS Code 或 DSH 的界面套一层壳。它同时依赖两个生态：VS Code 提供内置的 IDE 界面和扩展贡献的 UI，DSH 提供 client 插件、React 组件和浮层。两边的贡献方式并不一样——VS Code 有 part / container / view / editor / action / overlay，DSH 有 slot / React 组件 / overlay。如果按各自的模型直接摆，prac 很快就会变成两套布局、两套生命周期。

prac 的选择是：**复用两边的 UI 实现与运行时，但不复用它们的 layout**。VS Code 的 tree / webview / editor / 命令服务留着，workbench 的顶层 layout / grid / part placement 不复制；DSH 的 plugin graph / loader、slot registry、组件和 store 留着，`ui-layout` 的 AppFrame / 固定列 / 列宽策略不用。frame、布局拓扑、container、placement 和 host 边界由 prac 自己拥有。

| | 复用 | 替代 / prac 自己拥有 |
| --- | --- | --- |
| **VS Code** | 扩展宿主、tree / webview / editor 实现、命令与菜单服务、source-managed overlay 服务 | workbench 的顶层 layout / grid / part placement；prac 的 frame 拥有区域、container、placement |
| **DSH** | plugin graph / loader、slot registry、React 组件、store / locale / theme | `ui-layout` 的 AppFrame / 固定列 / 列宽策略；prac 自己声明 frame 槽并决定放置 |
| **prac** | — | 布局拓扑、container 组合、placement、host 边界、frame chrome、overlay layer、注意力（编排层） |

于是这个框架要回答四个问题：

1. **识别**：两个生态各自能贡献什么，哪些是 view、哪些是 container、哪些是 action、哪些是 overlay、哪些只是 part；
2. **摆放**：同一个区域里既有 VS Code 的 tree view，也有 DSH 的 React view，它们怎么进入同一个目录、同一套 placement；
3. **组合**：VS Code 的 container 怎么放 DSH 的 view，VS Code 的 view 又怎么被拿出来放到别处；
4. **生命周期与边界**：扩展启停、`when` 变化、插件装卸、HMR 时谁负责重读、谁负责保留布局；frame 怎么既不认识来源，又保证几何和 host 的边界。

### 组合要求（本 note 的硬约束）

这些问题里最硬的一条是组合。**“统一”不是把两个生态并排摆好，而是让它们的 UI 真正可组合：**

- VS Code 扩展声明的 container，**可以放入 DSH 插件贡献的 view**；
- VS Code container 里的 view，**可以被拿出来放到别的位置**；
- 反过来，DSH 声明的 container，也可以放入 VS Code 贡献的 view；
- 组合不要求两个来源共享运行时，也不要求 container 的成员关系由来源拥有。

这条要求直接决定了一个模型选择：**container 不能是“来源拥有的成员表”，它必须是 prac 自己的组合单元**。来源只能声明 container 的元数据（id / title / icon / location / order / hideIfEmpty），成员由 prac 的 placement 决定。

## 1. Guide-level design（模型）

### 1.1 三层：布局 / 内容 / 成员

```text
布局拓扑（几何）
  split / grid / region
        └─ region（叶子，唯一的几何槽位）
             └─ 内容根
                  ├─ view group（stack | select）
                  ├─ 单个 view
                  └─ opaque host

view group 的成员
  view ← placement（viewGroupId + order / hidden / folded / size）
```

模型要点：

- **布局节点只有 split / grid / region**；region 是叶子盒子，负责几何。
- **view group 不是第四个布局节点**，它是 region 的内容根；负责成员、mode、「选中 / 顺序」。
- **placement 不是节点**，它是 view → view group 的成员边；负责「这个 view 在哪个组、组内怎么排」。

### 1.2 布局拓扑与区域角色

| 节点 | 是什么 |
| --- | --- |
| **split** | 一维分区：沿 row / column 分配空间；孩子是 layout node |
| **grid** | 二维分区：行 / 列 / 单元格 / 跨格；**`stage` 的内容就是 grid** |
| **region** | 叶子盒子：只有一个内容根；内容根是 view group（stack / select）、单个 view 或 opaque host |

- **Grid 是一等节点**：`stage` 的内容是一个 grid；每个 cell 是一个 **region**，region 的内容根默认是一个 **select view group**（editor group），可以换成任何 view group 或 view——editor、tree view、DSH React view 都可以。文件编辑器、custom editor、webview panel 都是 editor view；它们在 VS Code adapter 内部映射到 `EditorGroupModel`。
- **树与 grid 的关系**：树仍然是组合结构（split → grid → region），grid 是树里的一个节点，不是另一棵树；grid 内部是二维的，外部仍然是一个盒子。这样“`stage` 是 grid”不会破坏“基础层是 partition tree”。
- **region 的位置**：结构位置 = `parentId` + slot；split 用 child index / track，grid 用 cell anchor + span（`rowStart / rowSpan / colStart / colSpan`）；绝对 rect 由 layout kernel 计算，不持久化。`stage` / `primary sidebar` / `secondary sidebar` / `panel` 是 arrangement 的 role；left / center / right / bottom 是它们的默认物理位置，不是 role 名。
- **grid 的 resize**：行 / 列 track 与 cell 的 `min` / `max` / `priority` / `snap` 是局部约束；拖一条 track 只影响该 grid 的行 / 列，不做全局求解。
- **stack 的行高 / 折叠**按已实现的 stack 行为；grid 的 resize 契约见 grid note。

#### 区域角色

| role | 默认物理位置 | 内容 |
| --- | --- | --- |
| **stage** | center | grid；editor groups / 任何 view |
| **primary sidebar** | left | container stack |
| **secondary sidebar** | right | container stack |
| **panel** | bottom | container stack |

- **role 是组件语义，物理位置是默认值**：`left` / `center` / `right` / `bottom` / `top` 是方位，不是 role 名。`top` 目前没有对应的 frame region role；如果以后有顶部区域，单独命名，不用 `top` 当 role id。
- **stage 是外层 split 的 center 节点**；它的内容是一个 **grid**，和 primary sidebar / secondary sidebar / panel 平级，但不是同一种节点。
- **grid 的每个 cell 是 region**；cell 的内容根默认是 **select view group**（editor group），也可以换成任何 view group 或 view——editor、custom editor、webview panel、DSH React view 都可以。
- **stage 是 editor view 的默认家**：文件编辑器、custom editor、webview panel、settings / keybindings 的 editor placement 默认落在这里；DSH view 也可以被放进某个 cell。
- **stage 是 arrangement 的 role，不是独立节点**：它的几何由 grid 表达；默认形状由 arrangement 提供模板，live 拓扑由 frame 的 layout kernel 独占，用户变更赢，来源只能请求。
- **editor group binding 是 adapter 内部实现**：cell ↔ view group ↔ `EditorPart` 的 editor group / `EditorGroupModel`；frame 只看到 view group，统一 group bar 由 frame 画。
- **stage 不是 VS Code workbench 的 grid / editor part 布局**：VS Code 的 part 内部结构留在 source runtime；prac 只接管外框、grid、cell 和 host 边界。

#### 拓扑的 owner、运行时变更与自定义

| 事 | 谁决定 |
| --- | --- |
| **默认拓扑**（初始 primary sidebar / stage / secondary sidebar / panel；stage 的 grid 形状） | arrangement 提供模板；frame 的 layout kernel 落成 |
| **live 拓扑**（现在这棵树） | **frame / layout kernel 独占**；只有它能改 |
| **用户变更**（split / merge / 移动 / 加删行列 / resize） | 用户通过 frame 的操作；用户意图赢 |
| **来源请求**（如 VS Code `addGroup`、编辑器要求拆组） | source adapter 通过窄通道**请求**，由 frame / arrangement 决定是否/如何应用；来源不能直接写树 |
| **持久化** | frame 的 layout store；来源状态不持久化 |

**可以进行时变更**，但要区分三种变更：

- **placement 变更**：view 换 view group / container；拓扑不变（只改 `placement`）。
- **几何变更**：resize / fold / collapse；拓扑和 placement 都不变，只改约束与尺寸。
- **拓扑变更**：split / merge / 加删 grid 的行列或 cell / 移 cell；只有这一种改树。

拓扑变更走一个小操作集，且必须满足不变量：不产生空 split；单孩子 split 合并；最后一个 region 不能删；选择不嵌套；container 移除时成员 rehome 或墓碑。所有变更在一个 store transaction 里完成，再持久化。

**自定义布局**分三种，不要混：

- **用户自定义**：支持——任意嵌套 split / grid、移动 view、加删行列 / cell、resize，并持久化；这是这套模型的默认能力。
- **命名 / 导入导出布局 preset**：暂不做；属于 arrangement 层，等真实需求再加（见推迟 H）。
- **来源自定义外框**：不支持——来源只能声明默认落位提示、请求拆组，或用 `opaque` host 拥有一块内部布局；它不能改 prac 的外框拓扑，否则用户和其他来源的组合权会被覆盖。

### 1.3 view group、container 与 placement

**view group 有一个 mode**：`stack`（顺序，多个 view 同时可见）或 `select`（选一，tab）。

- **container = 具名 view group，默认 `stack`**；Explorer 的 Open Editors / Folders / Outline 就是同一个 container 里的 stack。
- **container bar** 在父层 select 上切 container；**group bar** 只属于 select view group；stack container 没有 group bar。
- **`ViewGroupState`**：每个 group 都有 id / mode / active / order / tombstone；`active` 只属于 select；无名 group 也有 state，但没有 `ContainerRecord`。
- **group CR**（如 `VscodeViewGroup`）：CR 风格的 group 声明：`apiVersion` + `kind` + `metadata`（id / labels / annotations）+ `spec`（title / icon / role / order / hideIfEmpty 等）。`apiVersion + kind` 在声明时确定、不可变；frame 把它当 opaque 类型，不解析 source 语义。group 由 arrangement / frame 落成 `ViewGroupState`，declaration 不是 record。
- **`ViewGroupDefinition` / `ViewDefinition`**：CRD；分别定义 group / view 的 `apiVersion`、`kind`、schema、validation 和 factory。**Definition = 类型，Declaration = 实例。**
- **view CR**（如 `VscodeView`）：同一套 CR 信封：`apiVersion` + `kind` + `metadata`（id / labels / annotations）+ `spec`（label / icon / `paneHeader` / `hostKind` 等）。kind 是 view 类型，`hostKind` 是执行能力，两者不混；`prac.view` 承载的就是这个声明。
- **`ViewGroup`**：运行时对象，1:1 对应 `ViewGroupState`；持有 slots / hosts / `binding?`。source binding 是 runtime-only，不进 state。
- **`ContainerRecord`**：由 group CR materialize 出来的具名 group 记录，保存 `apiVersion` / `kind` / `metadata` / `spec` / `available` / `tombstone`；由 arrangement 的 view group registry 写入，随 `ViewGroupState` 一起进 frame 的 layout store；来源声明 CR，不拥有 record。成员不存，按 placement 派生。
- **身份**：placement 的目标是 `viewGroupId`；`ContainerRecord` 以同一个 `viewGroupId` 为 key；region id 只是布局节点 id；来源 container id 通过 group CR 映射，不是第二套成员键。
- **对象还是角色**：container 是 prac 的具体对象（view group + `ContainerRecord`）；editor group 是“select view group + adapter binding”的角色，具体的 `PracEditorGroup` / `EditorGroupModel` 在 adapter 里。

**placement**：`{ viewGroupId, order, front, hidden, folded?, size? }`。

- 它是 view → viewGroup 的**成员边**，不是拓扑节点。
- `order` 是组内 view 顺序；group 的兄弟顺序归 group state / layout。
- `active` 是 select view group 的状态，不是 placement 的字段。
- container 的成员不是独立成员表，而是所有指向它的 placement 的集合。

**选择只有一级**：父层 select 在 container / group 之间选一；container 内部是 stack（或分区）；select view group 内部是 view 的 tab。来源的子组要么扁平化，要么留在自己的 host 内部。

### 1.4 editor 与 editor group

- **editor 是 view**；文件编辑器、custom editor、webview panel、settings / keybindings 的 editor placement 都是 view。
- **editor view 的 host 是 `editor-pane`**。
- **editor group = select view group + editor binding**；它不是 prac 类型，只是 VS Code adapter 内部的 mapping（view group ↔ `EditorPart` 的 editor group / `EditorGroupModel`）。
- 非 editor view 如果也要进 editor part，由 adapter 选择是否包成内部 `EditorPane` / `EditorInput`；prac 模型仍然只看到 view group + view。
- **select view group 的 total order 是可见 tab 的顺序权威**；adapter 双向同步 editor 子集，source 端移动 editor 时投影回 group 顺序，并尽量保留非 editor view 的位置。
- **tab strip 由 frame 画一条统一的 group bar**；editor 的 dirty / preview / close / pinned 由 source 提供数据与 action。adapter 映射到 editor part 时，source 的 tab strip 不作为第二条可见 bar。
- **editor 的跨区域移动不是纯 host 搬运**：走到已有组时可能 `moveEditor`；activation 必须显式，且按 placement 而不是 resource。

### 1.5 其他 surface

**最小本体**：只有 **view** 是可挂载的东西；其余是格子、组、边或数据。

| 词 | 是什么 | 谁拥有 |
| --- | --- | --- |
| **view** | prac 可挂载的单元：身份 + host + 状态 | 来源（UI 实现 / 运行时） |
| **host** | 把一个 view 渲染进一个盒子的边界对象 | 来源 / adapter；frame 给盒子 |
| **action** | view / container / global 的命令面 | 来源提供并执行；frame 呈现 |
| **overlay** | frame-hosted overlay entry；behavior 可以是 source-managed（`shell.overlay`）或 frame-managed（`pracOverlay`，以后） | frame 拥有 host / layer / order；来源或 frame 拥有 behavior |
| **part item** | status bar 等部件级条目 | 来源 / 未来 part host |
| **focus** | 浏览器焦点所在的 view、焦点路由与恢复 | frame / host |
| **attention** | 当前“面”是对话还是编辑器、back 回哪 | **编排（业务）** |

**不是 view 的东西**：view group 是 stack / select 的组；container 是具名 view group；part 是区域角色；overlay 是浮层条目；action / command / keybinding 是命令面；decoration / sash / focus ring 是 frame chrome。

**host kind 表达可组合性**，不是来源名：

| host kind | 能力 | 移动语义 |
| --- | --- | --- |
| `react` | 完全可组合；frame 给盒子，React host 在盒子里建隔离根 | 只换盒子；DOM-only view 保持状态 |
| `view-pane` | 独立 `ViewPane`；可换盒子 | 同 placement DOM 保持；跨 container 可重建；webview view 的 iframe 例外 |
| `editor-pane` | 独立 editor pane；view 是文件 / 编辑器 | 走 source 的 editor / group move；activation 显式 |
| `slot` | DSH 槽的宿主；owner props 由 frame 提供 | 由 host slot 决定；不是 container |
| `opaque` | 来源拥有内部几何；prac 只能整体摆 | 整体移动；内部不参与组合 |

**overlay**：host 归 frame，behavior 分两种——source-managed 由来源自己定位 / 关闭 / 管焦点，frame 只给 entry host / layer / order；frame-managed 由 frame 管锚定 / 关闭 / 焦点 / 栈，等真实需求再做。view 内部的补全 / hover 留在盒内。source-managed entry 可以要求 `isolation: none`。

**focus / attention**：frame 只提供焦点机械事实（`focusedView` / 焦点恢复 / 不搬动位置的 `focus(viewId)`）；`focus` 到中心、`back()`、返回栈由编排的 `FocusStore` 拥有。

### 1.6 分层、权威与 adapter

```text
来源（VS Code extension host / DSH loader·graph）
  → source adapters：观察来源，投影成 contribution；拥有来源运行时
    → catalogue：有什么、状态、可用性、动作、container 元数据；不持有几何
      → arrangement：默认落位、角色、container 策略、注意力
        → layout kernel：布局拓扑、placement、选择、尺寸、持久化
          → frame renderer：chrome、container 条、host 挂点、overlay layer
            → hosts：React host / view-pane / editor-pane / slot
```

| 层 | 只回答 | 不回答 |
| --- | --- | --- |
| source adapter | 这个生态里现在有什么 UI、它属于谁、怎么运行 | 放在哪、怎么排 |
| catalogue | 有哪些 view / container / action / overlay，状态是什么 | 几何、区域、顺序 |
| arrangement | 默认放哪、container 怎么组织、注意力在哪 | view 内部、宿主实现 |
| layout kernel | 布局拓扑、placement、选中、尺寸 | 来源、DOM |
| frame renderer | 怎么画 chrome、container、host 挂点 | 来源运行时、view 内部 |
| host | view 怎么挂进一个盒子 | 外部几何、放置 |

**权威不是全有或全无**：prac 的 UI 模型是 **composition / placement / view group / container identity** 的权威；来源的 UI 模型是 **content existence / runtime / source actions** 的权威。adapter 是双向翻译层，不是第二个 UI 模型。

adapter 大在：observe → normalize → bind → project → context → host → lifecycle。它不大在：frame 的布局状态、来源 UI 的重实现、第二个注册表、业务注意力。

## 2. Reference-level（规则与约束）

### 2.1 组合规则

- **frame 只认 catalogue + placement**。frame 不读来源目录，不按来源前缀分派；host kind 是唯一窄分派。
- **一个 host 一个 view**。host 的身份是 view id，不是“某次放置”；移动时尽量搬 host，不重建。
- **host 的契约是 React + boundary**。frame 给盒子、隔离边界、active；host 自己观察尺寸、自己 mount / release、自己把焦点交给 view。
- **stable host 不是全局承诺**：只对 DOM-only / React view；editor 走 model + viewState；`view-pane` 跨 container 允许重建；webview / iframe 明确 reload（或稳定层 + 几何，不 reparent）。
- **activation 显式**。mount 不等于 activation；view 成为 front / 可见时，来源收到 `activate(viewId)`；编辑器靠它打开文件、给 pane `setVisible(true)`。
- **状态分轴**：contribution、availability、placement、user visibility、host、focus。`hidden` / `unavailable` / `absent` 不合并；移除先墓碑化 placement，显式 `forget` 才删除。
- **container 是 prac 的组合单元，来源只声明元数据**。`containerId` 只是默认补位提示；实际成员由 placement 派生。把 DSH view 放进 VS Code container、把 VS Code view 移出，都只是 placement 变化。
- **container id 命名空间化**：两个活跃来源声明同一个 container id 是组合错误，报诊断，不静默 last-wins。
- **action 是追加的**：同一 owner 上可以有多个贡献者，按 `(owner, contributor, actionId)` 合并；同 id 冲突报诊断。
- **overlay 的 host 归 frame，behavior 分两种**：source-managed / frame-managed，见 §1.5。
- **part 是区域角色，不是 view**；status bar items 是 part item，不是 view；这一版不做完整 part host。
- **G**：view 移出原 container 后，container 的 title actions / context keys 归当前 container；view 自己的 title actions / `viewsWelcome` 跟随；原 container 的 actions / context keys 不跟随。

### 2.2 设计约束

违反其中一条的设计，不接受：

- **一个几何权威**：frame 给盒子，host 只观察自己的盒子；frame 不向 host 传 `width/height`，也不替 host 做第二次测量。唯一的例外是 host slot 需要的 frame viewport，必须显式、窄、可测。
- **一个 view 存在性权威**：view 是否存在由 catalogue 的 contribution 决定；container 的存在性由 prac 的 `ContainerRecord` 承载，来源只声明元数据；不引入 `prac.container` slot 作为第二权威。
- **prac 模型是组合权威**：placement / view group / container identity 由 prac 决定；来源的 container / view 模型是表示，不是 frame 的权威。
- **DSH `ui-layout` 不是 frame**：prac 自己声明 root 槽与 frame；DSH 的 `sidebar` / `main` / `rightbar` 只是 host slot / view 来源。
- **VS Code workbench layout 不是 frame**：prac 不复制它的 Grid / Part 布局；VS Code 的 part 内部结构留在 source runtime。
- **container 是 prac 的组合单元**：成员永远由 placement 决定；来源的 `containerId` 不能把它拉回；container 不能因为来源消失就丢掉放进来的别家 view。
- **不是所有 UI 都是 view**：view group 是组，part 是区域角色，overlay 是浮层条目，action / command / keybinding 是命令面；只有 view 挂载。
- **一个 React host 契约**：禁止 `ViewHandle.layout/setVisible/focus/dispose` 这类第二套 imperative 渲染模型。
- **host kind 的能力要诚实**：webview / iframe、editor、opaque view 的移动语义由 host kind 说明。
- **frame 不装载代码、不认识来源**：frame 不 import / require / eval 来源 bundle；不出现 `vscode:` / `dsh:` 渲染分支。
- **一个持久化权威**：frame 的 layout store 是唯一持久化点；来源状态不持久化；overlay、注意力栈不持久化。

## 3. Drawbacks（代价与边界）

- **container 语义不随 view 走**：VS Code 的 `ViewPaneContainer` commands / context keys / visibility 依赖成员关系。view 被移出原 container 后，原 container 的 title actions / context keys 不跟随；view 自己的 title actions / `viewsWelcome` 跟随。这是“组合优先于上游 container 语义”的代价。
- **webview / iframe 移动会 reload**：host 重挂会换 browsing context；不假装能稳定，稳定 host 只承诺 DOM-only view。
- **editor 跨区域不是纯 host 搬运**：走到已有组的区域时可能 `moveEditor`；activation 必须显式，且按 placement 而不是 resource。
- **混合 select group 的 tab 顺序有同步成本**：group total order 权威；source 端 editor move 要投影回 group，非 editor view 的位置尽量保留。frame 的统一 group bar 承接 editor 的 dirty / preview / close / pinned 呈现，但不接管 source 语义。
- **来源消失不等于 container 消失**：container 里还有别家 view 时保留；元数据可墓碑化，显式 `forget` 才删。
- **HMR 可能重置 host 状态**：代码替换不承诺保留 view 内部状态。

**状态归谁**：

| 状态 | 归谁 | 进持久化 |
| --- | --- | --- |
| 布局拓扑、placement、顺序、fold、尺寸、选中、front | frame | 是 |
| 用户 `hidden`（view / container） | frame | 是 |
| `ContainerRecord` / 元数据 | prac | 是（墓碑可保留最后已知元数据） |
| view 存在性、availability、title / icon / flags | 来源 + catalogue 投影 | 否 |
| host 实例、mount 状态 | frame / host | 否 |
| view 内部状态（undo / 滚动 / 树展开 / webview） | 来源 | 来源决定 |
| 注意力 / 返回栈 / overlay | 编排 / frame | 否 |

## 4. Decisions（已定与推迟）

**已定**：

- **A**：container 的记录由 prac 的 `ContainerRecord` 持有，由 arrangement 的 view group registry 写入，随 group state 持久化；来源只声明 group CR（apiVersion / kind / metadata / spec）；成员由 placement 派生。不引入 `prac.container` slot 作为第二权威。
- **B**：stable host 只承诺 **DOM-only / React view**；editor 走 model + viewState（open target / close source），`view-pane` 跨 container 允许重建，webview / iframe 明确 reload（或用稳定层 + 几何，不 reparent）。
- **D**：**editor 是 view**；**view group 有 `stack` / `select` 两种 mode**；container 是具名 view group（默认 stack）；editor group 是 select view group + editor binding，不是 prac 类型，只是 VS Code adapter 内部的 mapping（`EditorGroupModel` ↔ view group）。view group 可以放任何 view；editor view 的 host 是 `editor-pane`；非 editor view 若进 editor part，由 adapter 决定是否包成内部 `EditorPane`。
- **I**：**select view group 的 total order 是可见 tab 的顺序权威**；adapter 双向同步 editor 子集，source 端移动 editor 时投影回 group 顺序，并尽量保留非 editor view 的位置。
- **J**：**frame 为 select view group 画一条统一的 group bar**；editor 的 dirty / preview / close / pinned 由 source 提供数据与 action，不另起一条 editor strip。stack container 没有 group bar。
- **E**：**注意力归编排**；frame 只提供焦点机械事实（`focusedView` / 焦点恢复 / 不搬动位置的 `focus`），`focus` 到中心、`back()`、返回栈由编排的 `FocusStore` 拥有。
- **G**：view 移出原 container 后，**container 的 title actions / context keys 归当前 container**；view 自己的 title actions / `viewsWelcome` 跟随；原 container 的 actions / context keys 不跟随。

**推迟（带触发条件）**：

- **C**：frame-managed overlay（`pracOverlay`）暂不做。触发条件：有 view 需要锚定到盒内元素、必须画到盒外，且 content-local / source-managed 不够；届时再实现 anchor / focus / stack / portal。
- **F**：status bar / part items 暂不做。触发条件：有真实 part 来源需要 surfacing；届时先归 part item，不塞进 view。
- **H**：命名布局 / 导入导出 preset 暂不做。用户手动布局现在支持；触发条件：用户需要保存 / 分享 / 切换多套布局。

## 5. Open questions（开放问题）

以下条目不阻塞这份 umbrella 的方向；每一条在对应 step note 中关闭。

1. **grid 的 cell / track 身份与持久化**：用 track id 还是索引；加删行列时 anchor 如何重写。关闭条件：grid step note + 迁移测试。
2. **G 的 adapter 投影**：虚拟 VS Code container / 窄 `ViewContainerContext` seam / 接受 source container context 失效。关闭条件：Folders 移入 DSH group 的 spike；设计见 [container context step](../proposed/2026-10-22-vscode-container-context.md)。
3. **host activation / focus 契约**：`activate(viewId)` 的调用者与顺序；shadow root / iframe 的焦点报告。关闭条件：host step note + focus 测试。
4. **`ContainerRecord` / group state 生命周期**：命名 / 去名、来源消失、墓碑化。关闭条件：state 模型 + 测试。
5. **editor group 与 `EditorGroupModel` 的同步算法**：source 端 reorder 如何投影回 select group total order，非 editor view 位置如何保留。关闭条件：adapter 双向同步测试。

## 6. Future possibilities / non-goals（范围与后续）

本 note 覆盖：两个生态的贡献归类、布局/容器/placement/host 的决策、跨来源组合规则。§5 的开放问题由后续 step notes 关闭。

不做（这一版，且不是永远不做）：通用 widget toolkit；重新实现 VS Code 的 tree / webview / editor / part 内容；通用插件运行时；多窗口 / 多标签页；完整 status bar / part；把业务注意力放进 frame。

## 7. Validation（怎么证伪）

- **跨来源组合**：把 DSH view 放进 VS Code container，再把 VS Code view 移出；来源卸载时 container 里还有别家 view 就不消失；frame 没有来源分支。
- **生命周期**：改标题 / 可用性不 remount；`when` 关 / 开原位恢复；卸载只移除自己；HMR 后布局不丢。
- **container / group mode**：Explorer container 同时显示多个 view；stage cell 默认是 select group；stack container 没有 group bar。
- **placement**：view 换 container 只改 placement；移动整个 region 只改 topology；tab 重排只改 placement 的 order。
- **stage / editor**：grid cell = region，内容根默认是 select view group；editor view host `editor-pane`；VS Code adapter 维护 editor 子集与 `EditorGroupModel` 的映射；track resize / 加删行列 / 移 cell 正确；移动承诺按 host kind 区分：DOM-only 不 release，editor 用 model + viewState，view-pane 可重建，webview / iframe reload；activation 打开正确文件。
- **G**：把 Folders 移出 Explorer 后，原 container 的 title actions / context keys 不跟随；view 自己的 title actions / `viewsWelcome` 跟随。
- **浮层**：VS Code 的菜单 / quick pick / 通知 / dialog 与 DSH toast / modal 同层按 order 共存；view 内部 hover / completion 不被抬出去。

## 8. Related

| note / doc | 关系 |
| --- | --- |
| [docs/ui-surface-map.md](../../../docs/ui-surface-map.md) | 两个生态的贡献面与术语表 |
| [2026-10-15-ui-layout-stack.md](../resolved/2026-10-15-ui-layout-stack.md) | stack 的行高 / 折叠 / 顺序行为（已实现） |
| [2026-10-15-ui-layout-grid.md](2026-10-15-ui-layout-grid.md) | split / grid 的 resize 契约 |
| [2026-10-17-vscode-host-architecture.md](../in-progress/2026-10-17-vscode-host-architecture.md) | VS Code adaptor 的层、对象、契约、surface |
| [2026-10-07-editor-host.md](../in-progress/2026-10-07-editor-host.md) | editor host 的对象与放置 |
| [2026-10-22-vscode-container-context.md](../proposed/2026-10-22-vscode-container-context.md) | container context step |
| [docs/concepts.md](../../../docs/concepts.md) | 词表与体系（旧词表；UI 术语以 ui-surface-map 为准） |
| [docs/architecture.md](../../../docs/architecture.md) | 目标架构（frame、能力、工作区） |
