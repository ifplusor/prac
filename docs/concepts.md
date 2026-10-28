# prac 的概念

> 这份是**词表与体系**：prac 用哪些词、每个词指什么、哪些**不是**。它是现在时的参考。
> 设计在 [architecture.md](architecture.md)；完整组合模型见 [2026-10-20-ui-framework.md](../.agents/notes/in-progress/2026-10-20-ui-framework.md)。

## 一句话

> prac 的 UI 由 **Application / Window / Widget board / Widget** 四类对象组成；frame 拥有 Space、布局、surface、window group / board 与 chrome；来源拥有内容；机制不认识来源。

## 一、对象

```text
Application（启动身份）
Window（app 打开的实例）
Widget board（布局面）
Widget（可组合内容）

Application --opens(1..N)--> Window
Window --hosts(0..1)--> Widget board
Dock / Panel --hosts(0..N)--> Widget board
Widget board --places(0..N)--> Widget
Window group --contains--> Window
```

| 对象             | 是什么                                                                                   | 不是                                |
| ---------------- | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| **Application**  | 启动身份；定义 window kind / single-multi / 默认 placement / 默认 composition / launcher | 不是内容容器；不直接进 window group |
| **Window**       | app 打开的实例；有 placement / lifecycle / active                                        | 不是 tab；不是 widget               |
| **Widget board** | 摆放 widget 的布局面                                                                     | 不是 app；不是 window；不是 region  |
| **Widget**       | 可组合内容                                                                               | 不是 window；不直接进 window group  |
| **Window group** | windows 的容器；tab strip 的 tab 是 window                                               | 不是 editor group；不是 board       |
| **Space**        | 命名的 stage 布局                                                                        | 不是 project folder                 |

### Window 两种

| kind                   | 内容              | 例子                                                        |
| ---------------------- | ----------------- | ----------------------------------------------------------- |
| **application window** | app-owned 内容    | editor（一个文件）、chat、diff、terminal、browser、settings |
| **widget window**      | 一个 widget board | stage 上的 Explorer board、单 Timeline board                |

- 所有 stage window 都是 editor input / `EditorWindow` 形态；
- application window 与 widget window 只是内容不同；
- widget window 由 board host app 打开；board composition 可改，window identity 不变。

### 关系约束

- window 可以没有 board（application window）；
- board 可以没有 window（panel / dock）；
- widget 可以没有 board（未放置）；
- window group 只包含 window；
- window owner（appId）与 widget source 是两件事；
- widget 在兼容 board 之间移动；placement 改、source 不变；
- 默认 move-only；copy 需要显式能力。

## 二、布局

```text
Space
  split / grid / region
       └─ surface
            ├─ window group（stage cell）
            └─ widget board（panel / dock）
```

- **split / grid / region** 是几何节点；region 是叶子盒子；
- **surface** 是 region 的内容根：
  - stage cell → window group；
  - panel / dock → widget board；
  - opaque host → 外部内容；
- **placement 有两条边**：
  - window → window group；
  - widget → widget board；
- **active 有两级**：
  - window group 的 active window；
  - board 的 active widget；
- **widget window** 是 window，内容是 board，不是 region。

## 三、Chrome / isolation

- window group tab strip / actions → frame + `ui-window`；
- widget header / actions → board / `ui-widget`；
- breadcrumbs → editor application window；不是 group tab strip；
- overlay：
  - 应用级 workbench overlay → frame float layer；
  - widget 内部 overlay → widget-local；
- window 是外层 containment / stacking / theme / focus 边界；
- 混排 VS Code + DSH 保留 per-widget root / source-scoped 子树；
- webview / iframe 自己的 browsing context。

## 四、来源

| 来源                                                          | prac                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| VS Code editor input（文件 / diff / custom editor / webview） | application window                                    |
| VS Code `ViewContainer`                                       | widget board / widget window                          |
| VS Code `ViewDescriptor`                                      | widget                                                |
| VS Code editor group                                          | window group 的 adapter runtime（`IEditorGroupView`） |
| VS Code 菜单 / 命令                                           | action model                                          |
| DSH `main` keyed entry                                        | application window                                    |
| DSH `sidebar` / `rightbar`                                    | widget board                                          |
| DSH 内部 slot                                                 | widget / section                                      |
| DSH `shell.overlay`                                           | frame overlay                                         |

- frame 不认识 `vscode:` / `dsh:`；
- adaptor 只翻译，不拥有 frame / window / widget 的 layout / active / placement；
- `prac.view` 是 widget 注册面；window / board 有各自注册面。

## 五、术语

| canonical              | 不要用                         | 说明                                                          |
| ---------------------- | ------------------------------ | ------------------------------------------------------------- |
| **application**        | app instance / container       | 启动身份；window 由 app 打开                                  |
| **window**             | tab / view                     | app 的实例；application window 或 widget window               |
| **window group**       | editor group / view group      | windows 的容器                                                |
| **widget board**       | container / view group / panel | 摆放 widget 的布局面                                          |
| **widget**             | view / tab                     | 可组合内容；在 board 里                                       |
| **placement**          | membership                     | window→group；widget→board                                    |
| **surface**            | region content                 | region 的内容根                                               |
| **application window** | editor view / editor group     | editor / chat / diff / terminal 的 window                     |
| **widget window**      | container window               | 承载 board 的 window                                          |
| **editor group**       | prac window group              | `IEditorGroupView`，adapter runtime                           |
| **editor window**      | separate window type           | editor application window 的简称                              |
| **catalogue**          | registry                       | 合并后的 widget / window 目录                                 |
| **source adapter**     | —                              | 把来源投影成 application / window / widget / action / overlay |

## 六、已退役

- **view group / container record**：board 的内部内容组 / 早期名字；不是独立对象；
- **seat**：没有独立对象；
- **region tree 直接以 view 为 child**：region 的 child 是 surface，不是 view；
- **editor group 作为 prac UI 类型**：只是 adapter runtime；
- **“view 是唯一单位”**：window 是编排单位，widget 是内容单元。

## 七、包

```text
ui-surface
ui-frame
ui-application
ui-window
ui-widget
ui-workbench
ui-dsh
ui-vscode-host / ui-vscode-views / ui-vscode-editor
bundle/web-app  // composition root only
```

完整依赖见 10-20 的 Package architecture。`ui-layout` 是迁移期 facade，最终删除。

## 八、相关

- [architecture.md](architecture.md)：目标架构。
- [ui-surface-map.md](ui-surface-map.md)：来源 → 对象映射。
- [ui-acceptance.md](ui-acceptance.md)：UI 验收。
- [2026-10-20-ui-framework.md](../.agents/notes/in-progress/2026-10-20-ui-framework.md)：组合模型 / package architecture。
