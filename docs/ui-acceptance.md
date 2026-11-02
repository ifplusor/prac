# UI Acceptance

The UI's live gates run against a real DSH rig and Chromium. `/Users/james` is
not a test fixture: the normal 3084 rig is the person's, so acceptance uses a
throwaway rig with its own XDG/HOME tree and removes it afterwards.

## One command

```bash
cd /Volumes/Dev/prac/prac-dev
pnpm verify:ui
```

It starts a rig on `PRAC_TEST_PORT` (default `3184`), installs the dynamic
fixture, runs the gates below, then proves the extension lifecycle by stopping
the rig, removing the fixture, starting again, and restoring it.

`pnpm verify:ui` needs permission to write the DSH profile outside the
workspace: the CLI resolves that profile from the user home even when
`XDG_DATA_HOME`/`HOME` point at the temporary tree.

## Gates

| gate                 | proves                                                                    |
| -------------------- | ------------------------------------------------------------------------- |
| `containers`         | dock rail lists the borrowed tools, switches their board windows, and proves an editor window can live in a sidebar WindowGroup plus the board window's identity projection |
| `board`              | the Explorer board window owns widget order / active / add / remove and renders its rows |
| `stack`              | Explorer stack rows, header fold / unfold, bodies                         |
| `split`              | left / center row split; dragging its sash resizes both sides             |
| `grid`               | dragging a cell swaps placements and the swap persists                    |
| `grid:resize`        | dragging a cell's resize handle changes its span and persists             |
| `grid:merge`         | grid merge / unmerge controls and persistence                             |
| `grid:view`          | a recall-catalogue row drags into a grid cell; placement persists         |
| `grid:tab`           | a mounted tab drags into another grid cell; placement persists            |
| `grid:free`          | dragging a track boundary changes column weights in pixels                |
| `resize`             | track resize, distribution, floors, centre priority                       |
| `persistence`        | frame + board layout state reload; a resized track and a folded board row persist |
| `bottom`             | bottom bar appears when filled, takes room, and returns it on collapse    |
| `views`              | recall surface: open, window catalogue (widgets are board-owned), hide/show, Escape |
| `file`               | editor surface, tab activation, second group, close/reopen                |
| `editor:group`       | split editor group, focus sides, empty group removal                      |
| `editor:close`       | dirty-close dialog, Cancel and Don't Save                                 |
| `tabs`               | tab order, activation, frame→`EditorGroupModel` reorder; window actions in the tab strip |
| `dynamic`            | a contributed view enters/leaves the catalogue without reload             |
| `lifecycle:absent`   | removing the extension removes catalogue/frame/host                       |
| `lifecycle:restored` | restoring the extension rebuilds catalogue/frame/host                     |

## Static gates

```bash
pnpm verify:packages
```

`verify:packages` checks the DSH plugin package graph (`ui-frame` /
`ui-widget` / `ui-workbench` / `ui-dsh` / adapters) and the bundle-is-a-leaf rule. Target packages that have not been split out yet are reported as skipped,
not failed. Current implementation-era gate names (`containers`, `editor:group`)
remain until the split lands.

## Planned live gates

These are not in `pnpm verify:ui` yet:

| gate              | proves                                            |
| ----------------- | ------------------------------------------------- |
| `window:tab`      | window group tab is a window; widget is not a tab |
| `window:active`   | active window per group; active widget per board  |
| `widget:move`     | widget moves across boards; source unchanged      |
| `widget:window`   | stage board is carried by a widget window         |
| `isolation:mixed` | VS Code + DSH mixed window keeps per-widget roots |

## Running one gate

Every gate takes `URL`:

```bash
URL='http://127.0.0.1:3084/?token=…' node tests/gates/verify-grid.mjs
```

`verify:grid-view` and `verify:dynamic` need the dynamic fixture installed.
`verify:extension-lifecycle` is phase-based and is driven by `verify:ui`; it is
not a standalone install/uninstall command.

## Noise

The page carries known noise from the embedded workbench: missing optional
native bindings, built-in extensions whose compiled output is absent, and
Monaco context-attribute warnings. `tests/gates/harness.mjs` filters only those
known lines; a gate's `own(prefix)` is expected to be empty.

## Adding a gate

1. Put it under `tests/gates/` and import `openPrac`/`report`/`requireUrl` from
   `tests/gates/harness.mjs`.
2. Use a real action and assert pixels or model state, not only DOM presence.
3. Add it to the ordered list in `scripts/verify-ui.mjs`.
4. Run `pnpm verify:ui` before committing.
