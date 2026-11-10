# 2026-11-07 新设计签收清单

> 过程材料，不是 note；用于 James 逐份 review。14 份 notes 当前均为 `in-progress`，不自我 promote。
>
> **签收语义（James，2026-11-07）**：签收 = 认可设计方向，不改 `status:`；这些设计 notes 在 MVP 开发交付前**长期保持 `in-progress`**。`resolved` 留到交付时再定。
>
> **范围（James，2026-11-08）**：只覆盖 11-05 设计集这 14 份；[dsh-anchor](../notes/in-progress/2026-10-12-dsh-anchor.md) 不纳入——它是独立工作，另行跟踪。

## 先签什么

建议按三批：

1. **产品 3 份**：scope、体验、MVP / 验收先定；否则技术设计没有优先级。
2. **核心对象 4 份**：architecture、ui、widget、extension；决定 window / board / extension 的基本形状。
3. **其余技术 7 份**：两个 adaptor、IDE、agent、runtime、quality、packages；多数可按设计默认推进，只有少数需要裁决。

## 产品

| note | 已写死的核心决定 | 需要你签 / 仍有 Open | 我的建议 |
| --- | --- | --- | --- |
| [product-design](../notes/in-progress/2026-11-05-product-design.md) | 唯一使用者 James；一个工作台；chat / notes / IDE 同界面；P1–P9；non-goals；指标 | 首要场景；MVP 边界；指标；non-goals 是否漏；产品 / 技术分界 | 先签“唯一用户 + 工作台 + P1–P4”；指标和 later 项可延后 |
| [product-experience](../notes/in-progress/2026-11-05-product-experience.md) | 人摆布局；MVP 不做自动注意力跟随；chat 是通道；notes 是文件；IDE 在 window / board 内 | chat single / multi；session 恢复范围；note 共编；approval 呈现；background；return stack；changed-files 历史；多窗口；体验指标 | chat 先 single；session 只恢复 window / active；approval 先 chat 内；return stack / 多窗口 later |
| [product-mvp](../notes/in-progress/2026-11-05-product-mvp.md) | stories / MVP / acceptance；验收由 James 签字 | first-run 入口；panel 默认；note 共编；chat 收起 / 恢复；application 产品化；Space 作用域；多窗口；review 约定 | 先签 first-run / 默认布局 / chat 恢复 / review；application launcher、多窗口 later |

## 核心对象 / 架构

| note | 已写死的核心决定 | 需要你签 / 仍有 Open | 我的建议 |
| --- | --- | --- | --- |
| [tech-architecture](../notes/in-progress/2026-11-05-tech-architecture.md) | DSH 主干；Browser / Server 两端；一个 server；code server / extension host / LSP 的部署边界 | 进程监督；模块 API；schema；并发；错误分类；安全模型；性能预算；生产部署 | 架构方向先签；进程监督 / schema / 性能预算作为后续实现门槛 |
| [tech-ui](../notes/in-progress/2026-11-05-tech-ui.md) | `PracWindow` / `WindowPlacement`；一个文件一个 window；tab 是 window group 的 window；WM / group / app 状态机 | 命名迁移；multi instanceKey；windowId 命名空间；app 移除；空 group；surface 替换；root merge；persistence schema；并发 | 先签命名 / windowId / app 移除；persistence schema 与并发放到实现前 |
| [tech-widget](../notes/in-progress/2026-11-05-tech-widget.md) | `PracWidget` / `WidgetPlacement`；board 是 window 内容；drag / dock / reset | default board 身份；multi-instance widget；copy 语义；跨 Space；dock overflow；empty board；同一 board 多 window；reset index；size reset | 先签“默认 move、copy 仅显式能力”；跨 Space / 多 window 作为 later |
| [tech-extension](../notes/in-progress/2026-11-05-tech-extension.md) | manifest → catalog → runtime；稳定 id `source:kind:id`；def version pinning；reconcile 不重启；host capability | 动态 view 边界；content handler 引入条件；公开 API | 三项都可现在关：动态 view 受 `when` / catalog 边界；content handler 留 later；不发布公共 SDK / marketplace |

## 其余技术

| note | 已写死的核心决定 | 需要你签 / 仍有 Open | 我的建议 |
| --- | --- | --- | --- |
| [tech-extension-vscode](../notes/in-progress/2026-11-05-tech-extension-vscode.md) | `prac.vscode-host` / `prac.vscode-editor` / `prac.vscode-views`；自动转换 `contributes`；host 在 client | 非 editor capabilities；catalog active / visible；editor host 切片；actions 覆盖 | MVP 先覆盖 views + editor；非 editor capabilities、actions 扩展 later |
| [tech-extension-dsh](../notes/in-progress/2026-11-05-tech-extension-dsh.md) | `prac.dsh-host`；chat / sidebar / rightbar；DSH 插件级贡献，不碰 Cordis 内部 | sidebar / rightbar 接入时机与内容类型；内部 slot 可移动性；`main` keyed entry 的 app 身份；session 切换 window 生命周期 | chat 先 app；sidebar / rightbar 先 host panel；main keyed app 身份 later |
| [tech-ide](../notes/in-progress/2026-11-05-tech-ide.md) | editor host / terminal / SCM / search / problems / output / settings | terminal 归格；capability 形状；SCM scope；search editor / 多根；debug / tasks；settings UI；output 保留；并发 | 最大分歧是 **terminal 归格**（app window vs panel widget），需要你裁决；debug / tasks later |
| [tech-agent](../notes/in-progress/2026-11-05-tech-agent.md) | chat / session / turn / plan / review / approval / artifacts；read model | chat single / multi；session 恢复；note 共编；approval 呈现；background；return stack；changed-files 历史；artifact 路由 | chat 先 single；note 共编先按文件 + 明确冲突策略；approval chat 内；其余 later |
| [tech-runtime](../notes/in-progress/2026-11-05-tech-runtime.md) | extension host / LSP / MCP / webview / extension policy；host 状态机 | host supervisor；workspace memento；autoSave 门；policy 自动化；webview 生产；built-ins；Copilot；LSP acceptance；MCP 实现 | MVP：host supervisor + LSP + webview；MCP later；built-ins 先 JSON / HTML / Markdown |
| [tech-quality](../notes/in-progress/2026-11-05-tech-quality.md) | security / logging / performance / a11y / i18n / persistence / testing / deployment | 性能数值；a11y 目标；i18n 范围；secret / MCP trust；日志 UI；生产部署；测试覆盖；错误文案 | 先签“最小基线，不追 WCAG / 全量 i18n”；生产部署 later |
| [tech-packages](../notes/in-progress/2026-11-05-tech-packages.md) | 包映射 / 依赖规则 / 构建入口；extension registry 角色 | lsp / turn-diff 包名；arrangement / chrome 拆包；IDE runtime 包；MCP 包；静态 gate | 先按现有映射；等 IDE / LSP 切片落地再拆包 |

## 建议的签收结论

- **产品 3 份**：先签方向与 MVP；Open 里只关“first-run / 默认布局 / review 约定 / chat single”。
- **核心 4 份**：签 window / widget / extension 的对象模型；extension 的 3 个 Open 现在关掉。
- **其余 7 份**：先签“MVP 范围 + later 列表”；terminal 归格单独裁决。
- **不签**：`proposed` 已经没有；这份清单不改变任何 note 的状态。

## 签收记录

- **2026-11-07 product-design**：方向认可（`status:` 仍 `in-progress`）。裁决：场景优先级从 P1–P4 的 4 个 job 起步；指标先定性、量化待第一次 dogfood；non-goals 原样。Open 2 指向 product-mvp，Open 5 由 §5 的「分界」句承接；§9 已删。
