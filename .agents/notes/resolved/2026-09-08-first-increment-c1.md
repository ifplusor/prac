# Agent Note: 第一个增量 = C1（最小可运行的 prac-on-DSH）

Status: resolved:settled

## Problem

开始构建 prac，需要确定自指 dogfood 的**第一个增量**是什么，且要作为一轮真实的决策来定（而非草率开始）。

## Decision

第一个增量 = **C1：最小可运行的 prac-on-DSH**——一个 bundle + `prac` profile（叠 `dsh-base` + `dsh-web-app`），挂一个近乎为空的插件，在 Web GUI 里确认能加载/运行。

理由：
- 它是后续 C2（决策空间工具）的 **surface 基底**。
- 它是当前**最该先验证的未知**（独立消费者到底能不能扩展 DSH——认识论循环的「先跑小的可验证单元」）。
- 用它来 dogfood 能测出「decision-first 对偏机械的任务，是真帮忙还是仪式感」——一个有价值的观察。

## Alternatives considered

- **C2（直接上决策空间工具）**：核心论题，但缺可运行的 surface（C1 是前提）。
- **C3（先纯流程验证，不写工具）**：最快验证流程，但不产出可交付物；作为 C1/C2 之前的预备。

## Next open decision

「**C1 怎么搭**」已裁决并落地，见 [2026-09-08-c1-build-prac-web-app.md](2026-09-08-c1-build-prac-web-app.md)。下一个开放决策是 **C2**（决策空间工具：带依据的候选决策作为模型可见输入）。
