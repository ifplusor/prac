# tests

The verification assets. `pnpm verify` is the only entry point; the roster and
the layers are described in [docs/testing.md](../docs/testing.md).

## Layout

| path                                    | role                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `run.mjs`                               | the CLI: `ui` / `static` / `gate <name>` / `list`                                                               |
| `gates.mjs`                             | the live gate roster (name → script); the one source of truth                                                   |
| `ui.mjs`                                | live acceptance: starts a throwaway rig, links the profile, runs the gates, then proves the extension lifecycle |
| `gates/`                                | live gates driven by `harness.mjs` (prac's own surfaces)                                                        |
| `static/`                               | static gates: client package entries, package dependency graph                                                  |
| `fixtures/`                             | the dynamic-extension fixture the lifecycle phase installs                                                      |
| `../vendor/vscode/scripts/verify-*.mjs` | live gates for the VS Code side (they import their own Playwright copy)                                         |

## Commands

```bash
pnpm verify                # static gates, then the full live acceptance
pnpm verify static         # entries + packages + pinned DSH types
pnpm verify ui             # live acceptance only
pnpm verify ui file,stack  # a subset of the roster
pnpm verify gate file      # one gate against URL=<a running page>
pnpm verify list           # the roster
```

A gate's failure prints the gate's full output and, through the harness, the page
console errors. Gates declare the checks that read internals in `probes: [...]`;
a probe failure after an intended model change means the gate is updated, not the
change reverted — the rule is in [docs/testing.md](../docs/testing.md).
