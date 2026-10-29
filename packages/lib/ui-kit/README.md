# prac-ui-kit

Framework-agnostic geometry, surface and binding kernel for layout-heavy UIs.

`prac-ui-kit` is the reusable core behind prac's UI. It contains no React, no DSH,
no VS Code and no application-specific window/widget model. A host supplies its
own renderer and product objects; the kit supplies the layout vocabulary and the
contracts that let geometry, content and hosting stay independent.

## Scope

```text
geometry     Space / Split / Grid / Region / Sizing / Box
tree         find / replace / first / fresh ids / subtree minimum
allocation   split claims, stack allocation, content allocation
grid         placements, tracks, move / resize / merge
view         ViewHost / View / MoveIntent
viewGroup    ViewGroup / state / placement / binding
surface      Surface / SurfaceRegistry / constraints
binding      geometry node → surface
snapshot     versioned serializable state
```

Not in scope:

- React components
- CSS / theme
- a DOM renderer
- DSH slots
- VS Code adapters
- prac's default arrangement
- application / window / widget product semantics

## Install

```bash
pnpm add prac-ui-kit
```

## Usage

```ts
import {
  SurfaceRegistry,
  findNode,
  gridPlacements,
  type GeometryNode,
  type Surface,
} from "prac-ui-kit";

const registry = new SurfaceRegistry<MyGroup>();
registry.register("board", {
  create: ({ nodeId }) => createBoardSurface(nodeId),
});
```

The host binds a geometry node to a surface:

```ts
const surface = registry.create("board", { nodeId: "left/container:explorer" });
host.bind("left/container:explorer", surface);
```

Any geometry node can carry a surface; a node does not have to be a leaf region.

## Package boundaries

```text
prac-ui-kit    pure reusable library
prac client    DSH plugins
prac bundle    composition only
```

The kit is published independently. `ui-frame` consumes it as a build-time
dependency and bundles the runtime into its client artifact; `ui-window` and
`ui-widget` only consume its contracts.

## Development

```bash
pnpm --filter prac-ui-kit build
pnpm --filter prac-ui-kit test
pnpm --filter prac-ui-kit check
```
