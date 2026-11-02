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
placement      PlacementRecord / LayoutState
store          LayoutStore / useLayout
switching      active-store switcher
snapshot       versioned serializable shape
workspace      workspace persistence scope
isolation      per-item shadow-root isolation
chrome         ChromeRegistry / contributions / intents
renderModel    the renderer's read-only placement helpers
renderer       LayoutRenderer over LayoutState<TRecord>
tabs/stack/sash/containerBar  generic chrome components
grid/resize/drag  grid handles, resize controller, sash / stack drag
```

Subpaths: `./content`, `./placement`, `./store`, `./switching`, `./snapshot`,
`./workspace-scope`, `./react`, `./isolation`, `./chrome`, `./renderModel`, `./renderer`, `./tabs`, `./stack`, `./sash`, `./containerBar`, `./grid`, `./resize`, `./sashDrag`, `./stackDrag`, `./chromeIntents`, `./containerChrome`, `./layoutIsolation`.

Not in scope: window / board / widget / Space / frame shell, DSH slots, source
adapters.
