# prac-ui-kit-layout

Framework-agnostic layout kernel: geometry, tree, allocation and grid.

`prac-ui-kit-layout` is **incubating inside the prac monorepo**. It contains no
React, no DOM surface, no DSH, no VS Code and no application-specific
window/widget model. It supplies the layout vocabulary and the pure solver; the
host supplies content, rendering and persistence.

It is deliberately `private` for now. The API is proven by prac's own plugins
first; publishing is a later decision, not a current promise.

## Scope

```text
geometry     Space / Split / Grid / Region / Sizing / Box
tree         find / replace / first / fresh ids / subtree minimum
allocation   split claims, stack allocation, content allocation
grid         placements, tracks, move / resize / merge
```

Not in scope:

- content surfaces / bindings / snapshot / layout roots (in `prac-ui-kit-workbench`)
- source adapters' view / view-group vocabulary
- React components
- CSS / theme
- a DOM renderer
- DSH slots
- VS Code adapters
- prac's default arrangement
- application / window / widget product semantics

## Usage

```ts
import type { LayoutNode } from "prac-ui-kit-layout/geometry";
import { findRegion } from "prac-ui-kit-layout/tree";
import { nodeBasis, allocateContent } from "prac-ui-kit-layout/allocation";

const tree: LayoutNode = {
  type: "split",
  id: "root",
  dir: "row",
  children: [
    {
      type: "region",
      id: "left",
      size: 280,
      flex: false,
      collapsed: false,
      cachedSize: 280,
      min: 160,
    },
    {
      type: "region",
      id: "center",
      size: 0,
      flex: true,
      collapsed: false,
      cachedSize: 0,
      min: 240,
      priority: "high",
    },
  ],
};

const sizes = tree.type === "split" ? allocateContent(tree.children.map(nodeBasis), 1200) : [];

const left = findRegion(tree, "left");
```

`tree` / `grid` are pure data; `find` / `replace` / `update` return a new tree.
Sizes come from `nodeBasis` + `allocateContent` / `allocateStack`; the kit never
touches the DOM.

## Package boundaries

```text
prac-ui-kit-layout   pure layout kernel (private)
prac-ui-kit-workbench    prac's frame engine: product model / content surface / React renderer
prac client          DSH plugins
prac bundle          composition only
```

`prac-ui-kit-layout` is the only layer that stays host- and product-agnostic.
`prac-ui-kit-workbench` builds the frame model, the content surface and the renderer
on top of it; `ui-frame` is the DSH plugin row that owns the store, the slot
catalogue and the DSH contract types, and `prac-client-ui-frame` / `prac-client-ui-widget` are the
consumers.

The package is not released from this repository yet.

## Development

```bash
pnpm --filter prac-ui-kit-layout build
pnpm --filter prac-ui-kit-layout test
pnpm --filter prac-ui-kit-layout check
```
