# ui-layout 设计

prac 自己的界面框架：它取代 `dsh-client-ui-layout` 那套固定的三栏，把"界面由谁拥有"从 **DSH** 手里拿回来。

**用词**：本文与相关 note 里的"上游"一律写明是哪一个——**DSH**（平台与契约，地基）或 **VS Code**（借用的 UI 与行为，行为与手感的来源）。

**范围**：这一份只讲 `packages/client/ui-layout`（`src/client/`，约 5.3 千行）。它管**布局**——区域、分栏、选择、顺序、几何、隔离边界、持久化。它**不管**内容：一个视图画什么、用什么框架、要不要发请求，都不是这个包的事（见 §8）。

---

## 1. 心智模型

三句话：

1. **布局归 prac**。区域树、编排、层级、浮层都是框架自己的，不是借用VS Code再补接缝。
2. **区域是骨架，视图是单位**。区域划分空间、给视图盒子；视图被摆放、被拖动、被隔离。分栏、拖放、迁移都发生在**区域**这一级。
3. **机制不认识视图的来源**。`vscode:` / `dsh:` / prac 自己的视图，走同一种对象、同一套契约、同一套保证。

### 1.1 三种节点、三种模式

树里只有两种节点：

| 节点         | 是什么                                                       |
| ------------ | ------------------------------------------------------------ |
| **`split`**  | 分栏分列（`row` / `column`），孩子各占一块，可拖 sash 改比例 |
| **`region`** | 一个**位置**，住视图或子区域                                 |

区域的孩子有两种，模式随孩子而定：

| 孩子是   | **顺序**（`stack`）  | **选择**（`tab`） |
| -------- | -------------------- | ----------------- |
| **视图** | 依次排开，每条可折叠 | 同时只显示一个    |
| **区域** | ——                   | 同时只显示一个    |

- **`stack`（顺序）**：一个区域里同时显示多个视图，各自有标题与折叠开关；高度在它们之间分配（§4.2）。这是 VS Code 侧栏那种"视图条"的形态。
- **`tab`（选择）**：同一时刻只显示一个孩子，切换的是**选中**（布局状态），不是叠放。`center`（中心区）与 `bottom` 用它。
- **容器 = 具名子区域**：VS Code的 Explorer / Search / SCM / Run **不是一个新对象**，而是"选择"区域下的一个孩子区域（例如 `left/container:workbench.view.explorer`）。所以容器之间是"选择"，容器内部是"顺序"。
- **悬浮层**是顶层的一个区域：住命令、通知，以及任何被临时放到那里的视图。它的内容按"这一次的呈现"渲染，**不进持久化**。

### 1.2 位置与角色分开

区域 id 是**位置**（`left` / `right` / `center` / `bottom`）；平台名（`primarySidebar` / `secondarySidebar` / `panel`）是**角色**，通过 DSH 的槽位绑定到位置上。VS Code自己也是这么分的（`workbench.sideBar.location` 让 primary 侧栏能放左或放右），所以 prac 不把两者焊死。

### 1.3 视图的三种摆放

放置规则是纯函数（`model.place` / `placeQuietly`），由**政策层**（`web-app` 的编排）决定用哪条；机制只保证"进 layout 就是进某个区域，区域给它盒子"。视图被移走时不复制内部状态——**迁移的单位就是它**。

---

## 2. 数据结构

`contract.ts` 是契约的唯一出处；`public.ts` 只做类型再导出，保证 dts 面稳定。

```ts
interface LayoutState {
  tree: LayoutNode; // 区域树
  views: Record<string, ViewRecord>; // 视图记录
  // …（与目录、几何相关的字段见 contract.ts）
}

type LayoutNode = SplitNode | RegionNode;

interface SplitNode {
  type: "split";
  id: string;
  dir: "row" | "column";
  size: number;
  flex?: boolean;
  children: LayoutNode[];
}

interface RegionNode {
  type: "region";
  id: string;
  size: number;
  flex?: boolean;
  min: number; // DEFAULT_MIN = 120 / CENTER_MIN = 240
  collapsed?: boolean;
  cachedSize?: number;
  embedder?: boolean; // 由嵌入方创建（编辑器组）——空且无内容时在启动期剪除
  children?: RegionChild[]; // 孩子：视图 id 或子区域；住子区域 ⇒ 该区域是"选择"模式
}

interface ViewRecord {
  region: string; // 住在哪个区域
  size?: number; // 顺序（stack）里的高度；缺省 = 与他人分享
  collapsed?: boolean; // 折叠：只剩标题
  front?: boolean; // 选择（tab）里显示哪一个
  // …
}
```

常量（`contract.ts`）：`SASH_SIZE = 5`、`DEFAULT_MIN = 120`、`CENTER_MIN = 240`、`CENTER_REGION = "center"`、`BOTTOM_REGION = "bottom"`；栈内下界与标题高在 `model.ts`：`MIN_ENTRY = 48`、`HEADER_HEIGHT = 20`。

**视图 id 形如 `<source>:<name>`**（`catalogue.ts`：`viewSource` / `DSH_VIEW_SOURCE = "dsh:"` / `DSH_SIDEBAR_VIEW` / `DSH_MAIN_PREFIX`）。prac 自己的视图注册进槽位 `prac.view`（`VIEW_SLOT`）。

---

## 3. 几何与尺寸

### 3.1 区域几何：一次算完

`resolveSizes(state, width, height) → Map<regionId, Box>` 把**树 + 容器尺寸**递归算成每个区域的盒子：

- `flex` 的节点分享剩余空间，非 `flex` 的用自己的 `size`；
- 每层的最小值由 `subtreeMin(node)` 汇总（`split` 求和，`region` 取 `max(node.min, …children)`）；
- 拖 sash 用 `sashSizes(...)`（纯函数），约束是**相邻两块的 min**。

⇒ 区域这一级的尺寸**只有一个权威**：树。

### 3.2 栈内高度：**两个空间**（当前设计的主要张力）

一个 `stack` 里每条视图的高度，当前由**渲染期的一个分配器**决定：

```ts
allocateStack(views, state, measured, height) → Map<viewId, height>
```

规则（对齐 `SplitView`）：每人先拿下界 `MIN_ENTRY`；把"人设的 `ViewRecord.size`"按序兑现；总量放不下就按比例缩；剩下的空间**按各条当前高度的比例分**（等价于VS Code `saveProportions` / `proportionalLayout` 的观感）。折叠的条目按 `HEADER_HEIGHT` 占位、不参与分配。

交互时谁写尺寸：

| 动作           | 函数                                                          | 语义                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拖条目底边     | `redistributeOnDrag(entries, viewId, target)`                 | 对齐 `SplitView.resize`：增量先给被拖那条与**上方**（最近优先），**下方**按 −增量让出；边界能走多远由**下方未折叠**的余量决定（不吃上面的）；折叠条目是标题，不给余量、也不被写 |
| 拖到极限       | `dragSnapTarget(entries, viewId, pointerDelta)`               | 邻条被挤过"下界一半" ⇒ 折叠它；被拖那条自己过一半 ⇒ 折叠自己；**不自动展开**（VS Code `IView.snap` 默认 false）                                                                    |
| 继续拖         | `dragChainTarget(entries, viewId, target)`                    | 下方余量耗尽 ⇒ 折下一条（链式），空间朝栈底走                                                                                                                                   |
| 折叠/展开      | `setViewCollapsed(state, viewId, collapsed, measuredHeight?)` | 折叠时记下当时高度（展开回到它）；展开时丢掉小于下界的残留                                                                                                                      |
| 让出的空间归谁 | `allocateStack` 的余量分配                                    | **从上往下逐条发**（`distributeEmptySpace` 的顺序）：先给折叠位置**下方**的条目，下方没有才往上                                                                                 |

**张力**：高度因此有**两个权威**——视图记录里的 `size` 与分配器**画出来**的值。两者可以不一致，`verify-persistence` 见过的现场是"存 69 / 画 519"。VS Code没有这个分叉：`SplitView` 的 `item.size` **就是**画面高度，布局过程会赋值它。收敛这两者的两条路（待裁）：

- **A**：保留两个空间，把分配结果**写回**视图记录（只在交互结束时写，避免启动/恢复期扰动）。
- **B**：把"栈"提升为**树里的结构**（栈 = 一个 split，每条 = 一个 region）⇒ 高度只剩树这一个空间，`allocateStack` 与 `redistributeOnDrag` 都可删。

### 3.3 交互的基准

拖动期间的算术以**拖动开始时冻结的快照**为基准（`pointerDelta` 与条目当时的尺寸），每帧从快照重算，不跨帧累积——这是VS Code `resize(index, delta, sizes, …)` 的形状，也是避免"自我放大"的关键。

---

## 4. 渲染（`frame.ts`）

`frame.ts` 把树画成 DOM，并拥有**唯一的几何决定权**：

- **区域**：`data-prac-region="<id>"`，`position: relative`，尺寸来自 `resolveSizes`；孩子的盒子由区域给。
- **选择（tab）**：只画 `front` 那个孩子，其余不渲染。
- **顺序（stack）**：每个视图一条 `data-prac-stack-entry="<viewId>"`；条头（`data-prac-stack-toggle`）有标题与折叠开关；`data-prac-stack-collapsed`、`data-prac-stack-handle` 供人与测试读；`data-prac-stack-body` 是内容盒。
- **手柄**：条目**底边 `SASH_SIZE` 以内**就是它的缩放手柄，监听挂在条目自身的**捕获阶段**（按下的目标是视图自己的 DOM，工作台的树可以 `stopPropagation`），提示用 `::after` 伪元素（带 `z-index`，否则被内容的层叠上下文盖住）。**最后一条没有手柄**——它的底边就是栈的边。
- **sash**：`data-prac-sash`，`SASH_SIZE = 5`，只在分栏的相邻子块之间出现。
- **框架的装饰**（sash、拖拽落点、焦点环）单列，画在内容之上，但不属于内容层序。

渲染层**不持有布局状态**：它订阅 store，从 `state` 算，然后把事件交回纯函数。

---

## 5. 隔离与主题

- **`isolation.ts`**：**所有**挂在 layout 里的视图都隔离，且**隔离不由视图选择**（否则就出现"我不用隔离"的例外，统一性当场破掉）。形态可以有多种（DOM 内容用影子域，自成体系的内容用独立浏览上下文），**选哪种由框架按内容决定**，并记进视图身份。**宿主同时是绝对与固定定位后代的包含块，并裁到盒内** ⇒ 视图画不到自己的盒子外面；要出现在盒外的只能走悬浮层。
- 框架自己的 UI（区域样式、sash、条头）必须**镜像进每个影子根**：`syncRoot` 按来源维护镜像，内容变化**原地重写**（`<style>` 被主题切换原地改写，所以不能整棵重建——那会闪）。
- **`theme.ts`**：`ThemePresenter` 把解析后的主题快照写进 DOM，隔离根由 `isolation.ts` 跟进。

---

## 6. 服务、接口与插件

- **`store.ts`**：一个不可变状态单元 + 订阅集，引擎是 DSH 的 `client-store` 快照 store；键是**版次**（`STATE_KEY = "prac-layout/v1"`），引擎只按原位水合，所以换版次是一次**有意的全量重置**。store 不知道放置规则——那些是 `model.ts` 的纯函数。

> 中文说**接口**，代码里的标识符是 `Face`（`LayoutFace` / `PracLayoutFace`）——它是**给消费者的契约**，不是遮住内部的 facade。

- **`services.ts`**：`createServices(store, …)` 在 store 与槽位注册表之上发布**三类消费者、三种形状**的接口（见文件的模块注释）。它不注册别的插件，只发布接口并返回清理函数。
- **`index.ts`**：插件本体（`name = "prac-client-ui-layout"`，`inject = ["slots", "theme", "uiSession"]`）。它声明 frame 的槽位、发布接口、跟随目录变化，并保持 DSH 那四个区域槽位的契约。**它发布的一切都是一个 `ctx.effect` 的清理函数**，卸载即回滚。
- **`catalogue.ts`**：视图目录——哪些 view id 存在、在哪里被声明。视图 id 是 `<source>:<name>`，"渲染在哪"来自目录，不来自 id 本身。

---

## 7. 持久化与启动

- 一个键：`prac-layout/v1`（`store.ts`）。树与视图记录一起序列化。
- 启动顺序：**load → 剪枝 → 放目录**。
  - `pruneEmbedderRegions(state)`：只剪**嵌入方创建**（`embedder: true`）**且不含内容**的区域——那是上一次页面留下的空壳（文件不跨刷新恢复，所以没有组、也没有壳去关它）。
  - **应用自己造的空区域要保留**：它的视图只是"还没被放进来"（`verify:split` 就是靠一个空区域把几何恢复回来的）。**保留 ≠ 不占地**——空区域仍然贡献自己的 `min`。
  - 然后按目录 `place` 视图。

---

## 8. 与VS Code的分工

|                                                         | 谁拥有                                                |
| ------------------------------------------------------- | ----------------------------------------------------- |
| 区域树、分栏、选择、顺序、几何、浮层、隔离边界          | **prac**（这个包）                                    |
| 视图的**内容**（编辑器、终端、语言服务、扩展贡献的 UI） | VS Code（引入源码树 + patch + overlay，不 fork） |
| 视图的**来源**（谁声明的）                              | 目录（`catalogue.ts`），机制只按注册表成员认识它      |

**对齐优先**：凡是VS Code有明确机制的地方（`SplitView` 的重分配与 snap、`distributeEmptySpace` 的顺序、`setVisible` 的缓存尺寸），prac 照做而不是发明；确有取舍时写成显式决定，不留在代码里当暗规则。

---

## 9. 不变式

- **G1 隔离是框架的保证**：每个视图都被隔离，内容不需要配合，也不需要声明。
- **G2 盒子是硬边界**：宿主是包含块且裁到盒内；越界只能走悬浮层。
- **G3 对等**：边界上对等（一样的盒子、一份契约、一套保证，没有特权视图），对待上对等（机制不认识来源）。

---

## 10. 已知张力与待裁

1. **栈内高度的两个空间**（§3.2）：写回（A）还是把栈提升为树结构（B）。B 从设计上消掉分叉，代价是一次结构性重构。
2. **`ctx.layout` 手抄的 **DSH** 契约会静默漂移**：VS Code加成员、prac 没跟上时，外壳会整块起不来，而唯一的报错是一句 `Cannot read properties of undefined`；本仓库的类型检查对着**已发布**的版本、app 跑 checkout，两个 `ILayout` 不是同一类型，`satisfies` 也写不成 ⇒ 这类契约要自己加守卫。
3. **组头**（tab 条 + 面包屑）：tab 归 prac（区域的 tab 条已有）；**面包屑挂在组头上**——是先让 prac 的 tab 条只做 tab、把组头其余部分搬进来，还是另行处理，单独裁一次。

---

## 11. 文件索引

| 文件                                                                         | 职责                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract.ts`（572）                                                         | 契约与类型：`LayoutState` / `LayoutNode` / `ViewRecord` / `Box` / 常量 / `LayoutFace` / `PracLayoutFace` / 角色绑定                                                                                                                                                                                                                       |
| `model.ts`（1255）                                                           | 纯函数：树与尺寸（`resolveSizes` / `sashSizes` / `subtreeMin` / `setRegionSize` / `splitRegionWith` / `removeRegion` / `pruneEmbedderRegions`）、放置（`place` / `placeQuietly` / `removeView` / `selectChild` / `setFront`）、栈内（`allocateStack` / `redistributeOnDrag` / `dragSnapTarget` / `dragChainTarget` / `setViewCollapsed`） |
| `frame.ts`（1228）                                                           | 渲染与交互：区域、选择、顺序、sash、条头与手柄、拖拽（捕获阶段 + 窗口级 move/up）                                                                                                                                                                                                                                                         |
| `isolation.ts`（279）                                                        | 每视图一个影子根；框架 UI 镜像与原地重写；硬边界                                                                                                                                                                                                                                                                                          |
| `services.ts`（401）                                                         | `createServices`：在 store 与槽位之上发布接口                                                                                                                                                                                                                                                                                             |
| `store.ts`（143）                                                            | 状态单元 + 订阅；`STATE_KEY`；DSH 快照引擎                                                                                                                                                                                                                                                                                                |
| `catalogue.ts`（150）                                                        | 视图目录与 id 形状                                                                                                                                                                                                                                                                                                                        |
| `theme.ts`（65）                                                             | `ThemePresenter`                                                                                                                                                                                                                                                                                                                          |
| `index.ts`（179）                                                            | 插件本体：声明槽位、发布接口、跟随目录                                                                                                                                                                                                                                                                                                    |
| `public.ts`（43）                                                            | 类型再导出（dts 面）                                                                                                                                                                                                                                                                                                                      |
| `model.spec.ts`（599）/ `catalogue.spec.ts`（101）/ `allocate-stack.spec.ts` | 单测：几何与放置、目录、栈内分配与拖拽算术                                                                                                                                                                                                                                                                                                |

## 12. 验证

- **单测**：`vp run --filter prac-client-ui-layout test`（模型、目录、栈内算术）。
- **活体门**（prac 侧）：`tests/gates/verify-{stack,split,containers,bottom,persistence}.mjs`——依次覆盖：一个视图裸渲染 / 两个视图成栈并折叠 / 借来的容器是具名子区域 / 底栏 / 状态随刷新回来。
- **与VS Code交界**（vendor 侧）：`vendor/vscode/scripts/verify-{layout,view,editor,file,views,outline,timeline,focus,tabs,close,quiet,group,stack-size}.mjs`。
- 探针（一次性测量）写在 `.build/scratch/exp*.mjs`，不入库。
