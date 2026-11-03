# tests

The verification assets. `vp run verify` is the only entry point; the roster and
the layers are described in [docs/testing.md](../docs/testing.md).

## Layout

| path                                    | role                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `gate.mjs`                              | one gate against a running URL                                                                                  |
| `gates.mjs`                             | the live gate roster (name → script); the one source of truth                                                   |
| `ui.mjs`                                | live acceptance: starts a throwaway rig, links the profile, runs the gates, then proves the extension lifecycle |
| `gates/`                                | live gates driven by `harness.mjs` (prac's own surfaces)                                                        |
| `static/`                               | static gates: client package entries, package dependency graph                                                  |
| `fixtures/`                             | the dynamic-extension fixture the lifecycle phase installs                                                      |
| `../vendor/vscode/scripts/verify-*.mjs` | live gates for the VS Code side (they import their own Playwright copy)                                         |

## Commands

```bash
vp run verify                # static gates, then the full live acceptance
vp run verify:static         # entries + packages + pinned DSH types
vp run verify:ui             # live acceptance only
vp run verify:ui -- smoke        # the inner loop: stack, views, split, tabs
vp run verify:ui -- grid,editor  # named groups
vp run verify:ui -- file,stack   # explicit gates
vp run verify:gate -- file   # one gate against URL=<a running page>
```

A gate's failure prints the gate's full output and, through the harness, the page
console errors. Gates declare the checks that read internals in `probes: [...]`;
a probe failure after an intended model change means the gate is updated, not the
change reverted — the rule is in [docs/testing.md](../docs/testing.md).
