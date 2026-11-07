# UI Acceptance

The UI's live gates run against a real DSH rig and Chromium. This page is the gate catalogue; [testing.md](testing.md) owns the system around it (layers, behaviour vs probe, how to change a gate). `/Users/james` is
not a test fixture: the normal 3084 rig is the person's, so acceptance uses a
throwaway rig with its own XDG/HOME tree and removes it afterwards.

## One command

```bash
cd /Volumes/Dev/prac/prac-dev
vp run verify:ui
```

It starts a rig on `PRAC_TEST_PORT` (default `3184`), installs the dynamic
fixture, runs the gates below, then proves the extension lifecycle by stopping
the rig, removing the fixture, starting again, and restoring it.

`vp run verify:ui` needs permission to write the DSH profile outside the
workspace: the CLI resolves that profile from the user home even when
`XDG_DATA_HOME`/`HOME` point at the temporary tree.

### One gate at a time

```bash
vp run verify:ui -- file          # one gate on the throwaway rig
vp run verify:ui -- file,tabs     # a few
```

The argument is a comma-separated subset of the gate names below (it sets `PRAC_GATES`); the rig, the
profile link and the fixture are the same, only the gate loop is narrowed. The
lifecycle phases are part of the full run only.

A failing gate prints its **complete** stdout/stderr (the probe values, the
report JSON, and — through the harness — the page console errors), not a tail,
so the assertion that failed can be read in place. `console errors` are printed
whenever a gate fails, not only for the "no prac-owned console errors" check.

## Gates

| gate           | proves                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `containers`   | dock rail lists the borrowed tools, switches their board windows, and proves an editor window can live in a sidebar WindowGroup plus the board window's identity projection |
| `board`        | the Explorer board window owns widget order / active / add / remove and renders its rows                                                                                    |
| `stack`        | Explorer stack rows, header fold / unfold, bodies                                                                                                                           |
| `split`        | left / center row split; dragging its sash resizes both sides                                                                                                               |
| `grid`         | dragging a cell swaps placements and the swap persists                                                                                                                      |
| `grid:resize`  | dragging a cell's resize handle changes its span and persists                                                                                                               |
| `grid:merge`   | grid merge / unmerge controls and persistence                                                                                                                               |
| `grid:view`    | a recall-catalogue row drags into a grid cell; placement persists                                                                                                           |
| `grid:tab`     | a mounted tab drags into another grid cell; placement persists                                                                                                              |
| `grid:free`    | dragging a track boundary changes column weights in pixels                                                                                                                  |
| `resize`       | track resize, distribution, floors, centre priority                                                                                                                         |
| `persistence`  | frame + board layout state reload; a resized track and a folded board row persist                                                                                           |
| `space`        | Space create / switch / restore; stage state per Space                                                                                                                      |
| `bottom`       | bottom bar appears when filled, takes room, and returns it on collapse                                                                                                      |
| `views`        | recall surface: open, window catalogue (widgets are board-owned), hide/show, Escape                                                                                         |
| `file`         | editor surface, tab activation, second group, close/reopen                                                                                                                  |
| `editor:group` | split editor group, focus sides, empty group removal                                                                                                                        |
| `editor:close` | dirty-close dialog, Cancel and Don't Save                                                                                                                                   |
| `tabs`         | tab order, activation, frame→`EditorGroupModel` reorder; window actions in the tab strip                                                                                    |
| `dynamic`      | a contributed view enters/leaves the catalogue without reload                                                                                                               |

`vp run verify:ui` also runs two lifecycle **phases** around the gate loop: `lifecycle:absent` (removing the extension removes catalogue / frame / host) and `lifecycle:restored` (restoring rebuilds them). They are phases, not roster gates.

## Static gates

```bash
vp run verify:static
```

The static gates check the DSH plugin package graph (`prac-client-*`, including the VS Code adaptor and changed-files packages) and the bundle-is-a-leaf rule. Target packages that have not been split out yet are reported as skipped, not failed. Current implementation-era gate names (`containers`, `editor:group`) remain until the split lands.

## Planned live gates

These are not in `vp run verify:ui` yet:

| gate               | proves                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| `window:tab`       | window group tab is a window; widget is not a tab                           |
| `window:active`    | active window per group; active widget per board                            |
| `widget:move`      | widget moves across boards; source unchanged                                |
| `widget:window`    | stage board is carried by a widget window                                   |
| `isolation:mixed`  | VS Code + DSH mixed window keeps per-widget roots                           |
| `window:lifecycle` | open → close → reopen; single reuse; app removal cleanup                    |
| `changed-files`    | turn-tail card; click file opens preview diff; latest only; binary disabled |

**Planned headless / 专项**（不进 `verify:ui`）：`lsp:query`、`webview:secure`、`extension-policy:live`。

## Running one gate

Every gate takes `URL`:

```bash
URL='http://127.0.0.1:3084/?token=…' node tests/gates/verify-grid.mjs
```

`verify:grid-view` and `verify:dynamic` need the dynamic fixture installed.
`tests/gates/verify-extension-lifecycle.mjs` is phase-based and is driven by `vp run verify:ui`; it is
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
3. Add it to the roster in `tests/gates.mjs`.
4. Run `vp run verify:ui` before committing.
