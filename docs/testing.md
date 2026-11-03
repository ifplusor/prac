# Testing

The testing system exists to make architecture changes **reviewable**: a change
must show that behaviour is preserved, and a test that fails must say whether it
was watching behaviour or an implementation detail.

## Layers

| layer                    | command                                                             | proves                                                                                                             | changes when                                                     |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **L0 static**            | `vp check`（types + lint）、`vp run verify:static`                  | package shape, client entry contract, dependency boundaries, pinned DSH types                                      | the convention changes (edit the convention doc + gate together) |
| **L1 unit**              | `pnpm test`                                                         | invariants of one object: the kit's registries, the frame's window manager, a board model                          | the object's contract changes                                    |
| **L2 model integration** | _(none yet — see below)_                                            | a cross-object path without a browser: `admit → seat → catalogue`                                                  | —                                                                |
| **L3 live acceptance**   | `vp run verify:ui`（`vp run verify:ui -- file,stack` for a subset） | what a person sees on a real rig: surfaces paint, tabs switch, state survives reload, no prac-owned console errors | the product behaviour changes                                    |

L0/L1 run in seconds and should run on every edit. L3 is the baseline for
"did the architecture change break the product"; it is expensive, so it runs at
step boundaries and before a commit that touches the frame.

## Behaviour versus probe

Every live check is one of two kinds:

- **behaviour** — a person can see it: a surface with text, a tab that activates,
  a fold that persists, a clean console.
- **probe** — it reads an internal: `__pracFrame.listItems()`, the slot registry,
  the embed face, a DOM shape.

Probes are allowed: some contracts (a window per placement, the projection order)
are only observable through the internals. But a probe is **coupled to the current
model**, so its failure means something different from a behaviour failure.

Gates declare their probes in the report (`probes: [...]`); the harness splits a
failure into the two groups:

```
FAILED: twoPlacementsAreTwoViews
  probes (update the gate if the model change was intended): twoPlacementsAreTwoViews
```

The rule:

1. **behaviour failed → fix the code.** No exceptions.
2. **probe failed → ask whether the model change was intended.**
   - intended → update the gate so it keeps expressing the same _intent_ under the
     new model (e.g. "two placements are two views" stays the intent; how the gate
     observes it may change), and record why in the worklog;
   - not intended → it is a defect; fix the code.
3. **Never delete a check to make a gate green.** If the intent no longer exists,
   delete it in a commit that says so.

This is the elasticity the last migration needed: deleting the `prac.window` seat
failed eight _probe_ checks in `verify-file`, not a behaviour check — the right
move was to keep the seat as an internal registry (and update the model), not to
abandon the change.

## Changing a gate

1. Reproduce with one gate: `vp run verify:ui -- file`.
   The failure prints the gate's full output, the classified checks, and the page
   console errors.
2. Classify: behaviour or probe (the report says which).
3. For a probe under an intended model change: change the probe's reading, not the
   gate's intent; add the check name to `probes` if it is new.
4. Run the full `vp run verify:ui`.
5. Record the model + gate change in `.agents/worklog/`.

## Current probes

`vendor/vscode/scripts/verify-file.mjs` declares the checks that read the frame's
item list or the embed's projection: `frameWindowIsProjected`, `chatActiveProjects`,
`fileActiveProjects`, `chatOrderProjects`, `chatMovesRegion`, `fileOrderProjects`,
`hiddenWindowUnmaps`, `shownWindowRemaps`, `previewSurvivesCloseReopen`,
`projectionIsQuiet`, `closingChatUnmapsProjection`, `splitEditorCopiesThePlacement`,
`twoPlacementsAreTwoViews`, `twoViewsAreTwoSurfaces`,
`directionalFocusFollowsTheTree`.

They are the coupling points to revisit whenever the window model, the seat names
or the projection change. Other gates read the DOM only and are behaviour by
default; add a `probes` entry when a check starts reading an internal.

## The gap to close: L2

The last two migrations were diagnosed twice on a four-minute live rig, because
there was no test between a unit object and the browser. The first L2 tests now
cover the catalogue union (`listCatalogueItems`: slots ∪ admitted windows, placed
and unplaced, the stale-entry case) and the manager's records. Still missing is a
single test that runs the whole seam against a real `LayoutStore`:

- `admit(app)` → the manager writes the seat → `listItems()` lists the window;
- `close(window)` → the seat is disposed **and** the catalogue no longer lists it
  (the stale-`p0` regression);
- a split's two placements → two admitted windows → two catalogue entries.

These need a fake slot registry and a real `LayoutStore`; they belong in
`ui-frame` next to `window-manager.spec.ts`. A model change should then fail a
two-second test instead of a four-minute gate.

## Toolchain

- The static gates are **TypeScript** (`tests/static/*.ts`) and run under `node`
  (type stripping), so `vp check` type-checks them. They used to be `.mjs` with
  JSDoc, which quietly escaped the type checker.
- The **orchestration** is `vite.config.ts` `run.tasks`: `verify`（static →
  live）、`verify:static`、`verify:ui`、`verify:gate`. `.mjs` only remains for
  the gate bodies (next bullet).
- The rig is started with the **anchor's pnpm shim by absolute path**, not the
  `pnpm` on PATH: under `vp run` the PATH's pnpm is the self-installed SEA that
  asserts (`SeaDeserializer` magic mismatch) inside the throwaway XDG tree, and
  the rig never publishes a URL.
- The **gate bodies** stay `.mjs`: each spawns a real rig and Chromium, and the
  vendor gates import their own Playwright copy (importing the harness there
  loads a second one and throws). They are not vitest cases for the same reason
  — a shared rig does not fit vitest's per-file isolation.

## What a new model object owes

- a unit test for every invariant it owns (uniqueness, lifecycle, single-instance
  reuse, close cleanup);
- a call-site test at the seam where it meets another object (the L2 gap);
- a behaviour check only if a person can see it.
