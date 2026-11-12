# prac-ui-kit-workbench

The workbench engine as a library: the product model (Space / Window /
WindowGroup / Board / Widget), region content, the frame binding and frame
state. It has **no DSH dependency** — no `@deepseek-ai/*` import, no plugin
lifecycle. The generic renderer and chrome live in `prac-ui-kit-content`.

The DSH side lives in [`prac-client-ui-frame`](../../client/ui-frame): the
persisted snapshot store, the DSH slot catalogue, the `SlotMap` / `Context`
merges and the services (`ctx.pracFrame`, `ctx.layout`, `ctx.pracSpaces`). The
engine here is consumed by that plugin and by `ui-widget`.

## Why it is separate from the lower layers

`prac-ui-kit-layout` is the pure layout kernel; `prac-ui-kit-content` is the
generic content composition layer. This package is the workbench layer on top of them:

```text
prac-ui-kit-layout     L0 geometry / tree / allocation / grid
        ↑
prac-ui-kit-content    L1 content protocols / placement / store
        ↑
prac-ui-kit-workbench      L2 Space / Window / Board / Widget / frame shell
        ↑
prac-client-ui-frame (plugin)   prac-client-ui-widget (prac adapter)
```

The kit exports no `apply` / `inject` / `name` and cannot be composed as a row.

## Design

The normative design (layers, the workbench model, and the L2 refactor under the
latest UI model) lives in
[`.agents/notes/in-progress/2026-11-12-tech-ui-kit.md`](../../../.agents/notes/in-progress/2026-11-12-tech-ui-kit.md).
The `region-bindings` / `group-bridge` / `window-group-model` entries below describe
the **pre-refactor** L2 and are being replaced by the model in that note.

## Scope

```text
contract / workbench-model    LayoutState / ItemRecord / WidgetRecord, WindowGroup
regionContent                RegionContent / RegionBinding / RegionContentRegistry
frameState                   FrameState / SpaceState / composed LayoutStore
model                        defaultTree, placement wrappers over ItemRecord
store                        LayoutStore / SpaceStore interface
region-bindings / group-bridge  group ↔ region binding and placement projection
layout-root / content-host-registry  frame / space / board roots and content-host registry
boardLayouts                 live board roots the frame renders
workbench-model / window-group-model  Window / Board / Widget and the generic window group
layoutActions / layoutDrop    L2-specific action and drop primitives
```

Not in scope:

- DSH plugin lifecycle, slot declarations, `apply` / `inject`
- prac content kinds / sources / catalogue / default arrangement
- the concrete adapter (`ui-widget`)

## Usage

```ts
import type { LayoutStore, ItemRecord } from "prac-ui-kit-workbench";
import { LayoutRenderer } from "prac-ui-kit-content";
```

The plugin supplies the persisted `LayoutStore`; the renderer itself is re-exported
by `prac-ui-kit-content`, not by this package.

## Development

```bash
pnpm --filter prac-ui-kit-workbench build
pnpm --filter prac-ui-kit-workbench test
pnpm --filter prac-ui-kit-workbench check
```

The package is private and not released from this repository yet.
