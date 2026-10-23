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

| gate                 | proves                                                               |
| -------------------- | -------------------------------------------------------------------- |
| `containers`         | container bars, one shown container per track, views mount and paint |
| `stack`              | stack rows, headers, overlay sash, fold, reorder                     |
| `split`              | side-directed splits, nested split, sash, reload geometry            |
| `grid`               | dragging a cell swaps placements and the swap persists               |
| `grid:resize`        | dragging a cell's resize handle changes its span and persists        |
| `grid:merge`         | Shift-drag merges adjacent cells; `⧉` unmerges and restores spans    |
| `grid:view`          | a recall-catalogue row drags into a grid cell; placement persists    |
| `resize`             | track resize, distribution, floors, centre priority                  |
| `persistence`        | versioned layout state reloads; stale regions are pruned             |
| `bottom`             | empty bottom bar, filled span, collapse/expand                       |
| `views`              | recall catalogue, hide/show, move, split, pixels                     |
| `file`               | editor surface, tab activation, second group, close/reopen           |
| `tabs`               | tab order, activation, frame→`EditorGroupModel` reorder              |
| `dynamic`            | a contributed view enters/leaves the catalogue without reload        |
| `lifecycle:absent`   | removing the extension removes catalogue/frame/host                  |
| `lifecycle:restored` | restoring the extension rebuilds catalogue/frame/host                |

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
