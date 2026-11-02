# Window / Board / Widget model (target)

The frame renders this model now. `FrameView` / `ViewGroup` remain the stage
editor group's runtime vocabulary; they are not a board's widget model, and
`WidgetBoardGroup` is gone.

```text
WindowGroup
  └─ Window
       └─ ContentHost
            ├─ editor
            ├─ chat
            └─ board (BoardContent)
                 └─ WidgetHost
```

- **WindowGroup** owns window order and the active window.
- **Window** owns one content host. A window is not a tab and not a widget.
- **ContentHost** is the mount / release / focus boundary. Editor, chat and board
  implement it.
- **BoardContent** is a window content: it owns widget order, the active widget,
  and a **LayoutRoot** for the board's own split / grid / region tree.
- **LayoutEngine** is shared by the frame root and each board root. The frame root
  lays out windows; a board root lays out widgets. A board root is a _layout hole_
  inside a window content: window is the lifecycle / focus / theme boundary, but
  the board root participates in frame hit-testing, drag, resize and split.
- Cross-root widget drag is **move** only. A split is completed inside the target
  board root; widgets from two different windows are never merged into one
  cross-window region.
- **WidgetHost** is a child of a board; it is the landing point of a VS Code view
  or DSH slot. A widget is not a window.

## What is legacy

- `FrameView` / `View`: removed. The product has no view object; a source adapter
  owns its own view handle.
- `ViewGroup`: removed. The frame speaks `WindowGroup`; a board is not a group.
- `WidgetBoardGroup`: removed. A container's board is the content of a **board
  window** (`BoardWindow`); `BoardWindowAdapter` composes it with the generic
  `WindowGroupModel`. Widgets are its `LayoutState<WidgetRecord>` rows, rendered
  through the same `LayoutRenderer` as the frame.

## Migration order

1. frame renders `ContentHost` for a window instead of a generic `FrameView`; **the
   content-host seam exists** and the board window uses its live board instead;
2. `BoardContent` mounts the board surface directly — **done**: the frame's
   `BoardItem` renders the board root and subscribes to the board's store;
3. sidebar / panel surfaces become `WindowGroup` — **done**:
   `BoardWindowAdapter` is the surface; the region holds one board-window record;
4. a single editor window can live in a sidebar window group — **done**: a file view
   placed in a container region is hosted by that region's `BoardWindowAdapter`
   (`syncWindows`); the workbench owns its record, the group only lists it
   (`WindowGroupPlacement.owned: false`);
5. board window gets a `PracWindowInput` identity projection (empty pane) — **done
   where an editor group exists**: the workbench maps a board window into the
   group that hosts its sidebar's editor window; a region with no editor group has
   nowhere to project into, so the projection is a no-op there.

## Frame renderer rewrite (approved)

The current renderer is `region → surface → ViewGroup → FrameView → slot`. The
rewrite replaces the last two steps with a window content host:

1. A window record carries a `contentId`, not a `FrameView`.
2. A `ContentHostRegistry` maps `contentId` → `ContentHost` (`Window`/`BoardContent`).
3. A `WindowGroupSurface` renders windows in order and mounts the active window's
   content host into its content element.
4. `BoardContent` mounts a board surface directly; widgets stay board children,
   not frame `ViewGroup` members.
5. `WidgetBoardGroup` and the generic `FrameView` domain semantics left the board
   path: a board's widgets are `WidgetRecord`s in its own `LayoutState`, and a
   container's surface is a `WindowGroup` of board windows.

This is a frame-layer rewrite, not an adapter.
