# prac-ui-kit-frame

The workbench frame engine as a library: the product model (Space / Window /
WindowGroup / Board / Widget), the content surface, the React renderer and its
chrome. It has **no DSH dependency** — no `@deepseek-ai/*` import, no plugin
lifecycle.

The DSH side lives in [`prac-client-ui-frame`](../../client/ui-frame): the
persisted snapshot store, the DSH slot catalogue, the `SlotMap` / `Context`
merges and the services (`ctx.pracFrame`, `ctx.layout`, `ctx.pracSpaces`). The
engine here is consumed by that plugin and by `ui-window` / `ui-widget`.

## Why it is separate from the lower layers

`prac-ui-kit-layout` is the pure layout kernel; `prac-ui-kit-content` is the
generic content composition layer. This package is the workbench frame on top
of them:

```text
prac-ui-kit-layout     L0 geometry / tree / allocation / grid
        ↑
prac-ui-kit-content    L1 content protocols / placement / store
        ↑
prac-ui-kit-frame      L2 Space / Window / Board / renderer / chrome
        ↑
prac-client-ui-frame (plugin)   prac-client-ui-window / ui-widget (prac adapters)
```

The kit exports no `apply` / `inject` / `name` and cannot be composed as a row.

## Scope

```text
contract / windowModel  LayoutState / ViewRecord / WidgetRecord, WindowGroup, ContentHost
surface / layoutRoot / snapshot  content root, frame / board root, serializable shape
frameState             FrameState / SpaceState / composed LayoutStore
catalogue              view / region shapes + prac's own slot keys
model                  placement, split, stack, grid, tab reorder
store                  LayoutStore / SpaceStore interface + React hook (re-export of content)
switching              LayoutStore switcher (re-export of content)
layoutRenderer         re-export of the content renderer
layout* / chrome*      tabs, stacks, sashes, grid handles, actions, drag, drop
boardLayouts           live board roots the frame renders
isolation              shadow-root isolation for hosted content
```

Not in scope:

- DSH plugin lifecycle, slot declarations, `apply` / `inject`
- prac content kinds / sources / catalogue / default arrangement
- the concrete adapters (`ui-window` / `ui-widget`)

## Usage

```ts
import { LayoutRenderer, type LayoutStore, type ViewRecord } from "prac-ui-kit-frame";
```

The plugin supplies the persisted `LayoutStore`; this package is for code that
needs the model or the renderer, not the live instance.

## Development

```bash
pnpm --filter prac-ui-kit-frame build
pnpm --filter prac-ui-kit-frame test
pnpm --filter prac-ui-kit-frame check
```

The package is private and not released from this repository yet.
