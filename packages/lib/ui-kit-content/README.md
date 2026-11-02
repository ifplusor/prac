# prac-ui-kit-content

Generic content composition kernel: content roots / groups / items, placement
state, store, snapshot and isolated mounting. No DSH, no product window / board
model.

This is **L1** of the UI kit: it can be used inside a window / page / panel
without adopting the workbench's window / Space / frame shell. The React renderer and chrome live here too; the workbench model builds on this
layer. A headless consumer can use the model / store subpaths.

## Scope

```text
content        ContentRoot / ContentGroup / ContentItem / ContentHost
hostMount      ContentHostMount (React)
placement      PlacementRecord / LayoutState
store          LayoutStore / useLayout
switching      active-store switcher
snapshot       versioned serializable shape
workspace      workspace persistence scope
isolation      per-item shadow-root isolation
chrome         ChromeRegistry / contributions / intents
render-model   the renderer's read-only placement helpers
renderer       LayoutRenderer over LayoutState<TRecord>
tabs/stack/sash/container-bar  generic chrome components
grid/resize/drag  grid handles, resize controller, sash / stack drag
```

Subpaths: `./content`, `./placement`, `./store`, `./switching`, `./snapshot`,
`./workspace-scope`, `./content-host-mount`, `./react`, `./isolation`, `./chrome`, `./render-model`, `./renderer`, `./tabs`, `./stack`, `./sash`, `./container-bar`, `./grid`, `./resize`, `./sash-drag`, `./stack-drag`, `./chrome-intents`, `./container-chrome`, `./layout-isolation`.

Not in scope: window / board / widget / Space / frame shell, DSH slots, source
adapters.
