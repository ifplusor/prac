/**
 * A generic layout renderer over `LayoutState<TRecord>`.
 *
 * It owns **geometry**: split / grid / region / stack rows, the allocation the
 * solver handed out, and the chrome anchors around each node. It owns no
 * policy: content comes from `renderItem`, control surfaces from a
 * `ChromeRegistry`, gestures and container markers from `decorate`. A frame
 * tree and a widget-board root therefore go through the same path; they differ
 * only in the props they assemble.
 *
 * @module prac-ui-kit-content/layoutRenderer
 */
import { createElement, Fragment } from "react";
import type {
  ClassAttributes,
  CSSProperties,
  DragEvent as ReactDragEvent,
  HTMLAttributes,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from "react";
import { gridShape, gridTrackWeights } from "prac-ui-kit-layout";
import type {
  Box,
  Dir,
  GridNode,
  GridPlacement,
  LayoutNode,
  RegionNode,
  SplitNode,
} from "prac-ui-kit-layout";
import type { LayoutState, PlacementRecord } from "./placement.js";
import { ZERO_BOX, type StyleObject } from "./renderModel.js";
import {
  STACK_HEADER_HEIGHT,
  activeChild,
  chosenChild,
  edgeRegion,
  entrySashState,
  frontView,
  isPresent,
  showsTabStrip,
  visibleViews,
} from "./renderModel.js";
import type {
  ChromeAnchor,
  ChromeContext,
  ChromeItemFacts,
  ChromeRegistry,
  ChromeSlotFace,
  LayoutIntents,
} from "./chrome.js";

/** Props of one DOM element a decorator adds to. */
type DivAttributes = ClassAttributes<HTMLDivElement> & HTMLAttributes<HTMLDivElement>;

/** Extra DOM props a container attaches to a node it does not own geometrically. */
export interface LayoutDecoration {
  /** Attributes to add (surface markers, container data attributes, …). */
  readonly attrs?: Readonly<Record<string, string | number | undefined>>;
  /** Style merged over the renderer's own (decoration wins). */
  readonly style?: CSSProperties;
  readonly ref?: (element: HTMLDivElement | null) => void;
  readonly onPointerDownCapture?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onDragLeave?: (event: ReactDragEvent<HTMLDivElement>) => void;
  readonly onDrop?: (event: ReactDragEvent<HTMLDivElement>) => void;
}

/** Which kind of element a decoration applies to. */
export type LayoutNodeKind = "region" | "split" | "grid" | "cell";

/** Context a container gets for one node it may decorate. */
export interface LayoutDecorationContext<
  TRecord extends PlacementRecord,
> extends ChromeContext<TRecord> {
  readonly kind: LayoutNodeKind;
}

/** Options the renderer passes when it asks for one item's content. */
export interface ItemRenderOptions {
  /**
   * `"frame"`: the frame owns the row's title, so the item must not draw its
   * own duplicate collapse affordance.
   */
  readonly chrome?: "frame";
}

/** One renderer instance's inputs. */
export interface LayoutRendererProps<TRecord extends PlacementRecord> {
  readonly state: LayoutState<TRecord>;
  /** The subtree to render; defaults to `state.tree`. */
  readonly root?: LayoutNode;
  /** The parent split's axis for the root (defaults to `"row"`). */
  readonly dir?: Dir;
  /** Whether the root is a selector's chosen child (it fills its parent's box). */
  readonly fill?: boolean;
  /** Per-node allocations (px); absent means "no measured box yet". */
  readonly sizes?: ReadonlyMap<string, Box>;
  /** Render one item's content by its record. */
  readonly renderItem: (
    record: TRecord,
    viewId: string,
    box: Box,
    options?: ItemRenderOptions,
  ) => ReactNode;
  /** Optional chrome contributions around the geometry. */
  readonly chrome?: ChromeRegistry<TRecord>;
  /** Mutations chrome may request. */
  readonly intents?: LayoutIntents;
  /** The container's slot dispatcher, forwarded to chrome contributions. */
  readonly slotFace?: ChromeSlotFace;
  /** The container's declared item facts, forwarded to chrome contributions. */
  readonly itemFacts?: (itemId: string) => ChromeItemFacts;
  /** Whether one item brings its own pane header (draw chrome as an overlay). */
  readonly ownHeader?: (record: TRecord, viewId: string) => boolean;
  /** The pane for a chosen selector child with nothing visible in it. */
  readonly renderEmpty?: (ctx: ChromeContext<TRecord>) => ReactNode;
  /** Container markers, surface attachment and gestures for a node. */
  readonly decorate?: (ctx: LayoutDecorationContext<TRecord>) => LayoutDecoration | undefined;
}

/** A region's flex sizing: flexible, fixed at `size`, or collapsed to nothing. */
function regionStyle(node: RegionNode, dir: Dir, fill = false, allocated?: number): StyleObject {
  if (node.collapsed) {
    // A folded stack row is **only its header** — a row that vanished entirely would lose the fold
    // switch that opens it again (design B4/D1).
    if (node.entry === true)
      return {
        flex: `0 0 ${STACK_HEADER_HEIGHT}px`,
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      };
    return { flex: "0 0 0px", minWidth: 0, minHeight: 0, overflow: "hidden" };
  }
  // The minimum is expressed on the split's own axis: a flex region with
  // `min-width: 0` can be squeezed to nothing by its siblings.
  const minimum = {
    minWidth: dir === "row" ? node.min : 0,
    minHeight: dir === "column" ? node.min : 0,
  };
  const stack: StyleObject =
    node.stack === true || (node.children?.length ?? 0) > 0
      ? { display: "flex", flexDirection: "column" }
      : {};
  // A selector's child is not sized by a split — the selector hands it the whole
  // box — so it always fills, whatever basis it carries.
  if (fill) return { flex: "1 1 0", ...minimum, overflow: "hidden", ...stack };
  // A stack row is **drawn** at what the allocation gave it. The tree's `size` is only that row's
  // claim: the room a region gains has to end up in exactly one row (C6/C8), and which row that is
  // was decided by `allocateStack`, so the style has to follow the allocation rather than the claim.
  if (allocated !== undefined) {
    return {
      flex: `0 0 ${Math.round(allocated)}px`,
      ...minimum,
      overflow: "hidden",
      ...stack,
    };
  }
  if (node.flex) return { flex: "1 1 0", ...minimum, overflow: "hidden", ...stack };
  return { flex: `0 0 ${node.size}px`, ...minimum, overflow: "hidden", ...stack };
}

/** A split's flex container: one axis, with children sized by their own basis. */
function splitStyle(node: SplitNode): StyleObject {
  // The basis is the region's, the way `regionStyle` computes it: a split that took a **fixed**
  // region's place (a stack standing where the track was) has to keep that size, not take a share.
  // A size of 0 means "no opinion" — the container layer builds its children that way — while a
  // positive size with `flex: false` is a fixed extent the region carried over (the track a stack
  // now stands in). Either way the split must not shrink a sized neighbour.
  const basis =
    node.flex === false && (node.size ?? 0) > 0 ? `0 0 ${node.size}px` : ("1 1 0" as const);
  return {
    display: "flex",
    flexDirection: node.dir === "row" ? "row" : "column",
    flex: basis,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  };
}

/** The grid's own box: a real CSS grid, or transparent when it draws one cell. */
function gridStyle(node: GridNode, cells: number): CSSProperties {
  if (cells <= 1) {
    // One cell is topology, not a second box: `display: contents`
    // keeps the cell in the parent split's geometry.
    return { display: "contents" };
  }
  const shape = gridShape(node, cells);
  const columnWeights = gridTrackWeights(node, "column", shape.columns);
  const rowWeights = gridTrackWeights(node, "row", shape.rows);
  return {
    display: "grid",
    gridTemplateColumns: columnWeights.map((weight) => `${weight}fr`).join(" "),
    gridTemplateRows: rowWeights.map((weight) => `${weight}fr`).join(" "),
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    position: "relative",
  };
}

/** The stack body wrapper: the row's content box, sized to the row's allocation. */
const STACK_BODY_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: "1 1 auto",
  minHeight: 0,
  position: "relative",
  overflow: "hidden",
};

/**
 * Render a layout tree.
 *
 * @param props - layout state, allocation, item renderer and chrome.
 * @returns the tree's React output.
 */
export function LayoutRenderer<TRecord extends PlacementRecord>(
  props: LayoutRendererProps<TRecord>,
): ReactElement {
  const {
    state,
    chrome,
    intents,
    slotFace,
    itemFacts,
    renderItem,
    ownHeader,
    renderEmpty,
    decorate,
    sizes,
  } = props;
  const rowHeights: ReadonlyMap<string, number> | undefined =
    sizes === undefined ? undefined : new Map([...sizes].map(([id, box]) => [id, box.height]));

  /** One chrome anchor, keyed so it can sit in a children list. */
  const anchor = (key: string, name: ChromeAnchor, ctx: ChromeContext<TRecord>): ReactNode =>
    chrome === undefined ? null : createElement(Fragment, { key }, chrome.render(name, ctx));

  /** One keyed child, so variadic children never warn about missing keys. */
  const keyed = (key: string, node: ReactNode): ReactNode => createElement(Fragment, { key }, node);

  /** The chrome context for one node. */
  const chromeContext = (
    node: LayoutNode,
    itemId: string | undefined,
    extra?: Partial<ChromeContext<TRecord>>,
  ): ChromeContext<TRecord> => ({
    state,
    node,
    regionId: node.id,
    ...(itemId === undefined ? {} : { itemId }),
    ...(intents === undefined ? {} : { intents }),
    ...(slotFace === undefined ? {} : { slotFace }),
    ...(itemFacts === undefined ? {} : { itemFacts }),
    ...extra,
  });

  const renderNode = (node: LayoutNode, dir: Dir, fill = false): ReactNode => {
    if (node.type === "region") return renderRegionNode(node, dir, fill);
    if (node.type === "grid") return renderGridNode(node, dir);
    return renderSplitNode(node);
  };

  const itemContent = (
    viewId: string | undefined,
    box: Box,
    options?: ItemRenderOptions,
  ): ReactNode => {
    if (viewId === undefined) return null;
    const record = state.views[viewId];
    if (record === undefined) return null;
    return renderItem(record, viewId, box, options);
  };

  const renderRegionNode = (node: RegionNode, dir: Dir, fill: boolean): ReactElement => {
    const box = sizes?.get(node.id) ?? ZERO_BOX;
    const views = visibleViews(state, node.id);
    const chosen = chosenChild(state, node);
    const child = activeChild(state, node);
    // The pane follows what was **picked**: a container with nothing in it says so, instead of the
    // track quietly rendering a different container. The fallback still covers the other case — the
    // record names nothing that is in the tree any more — where there is nothing to name a pane after.
    const shown = chosen ?? child;

    if (shown !== null) {
      const decoration = decorate?.({
        state,
        node,
        regionId: node.id,
        itemId: shown.id,
        ...(intents === undefined ? {} : { intents }),
        box,
        kind: "region",
      });
      const children: ReactNode[] = [
        anchor("frame", "region.frame", chromeContext(node, undefined)),
        // The bar marks what the person **picked**; when nothing of it is on screen the pane
        // below says why instead of the track quietly showing a different container.
        anchor("bar", "region.header", chromeContext(node, shown.id)),
      ];
      if (chosen !== null && !isPresent(state, chosen)) {
        children.push(
          keyed("empty", renderEmpty?.(chromeContext(node, chosen.id, { box })) ?? null),
        );
      } else if (child !== null) {
        children.push(keyed("child", renderNode(child, dir, child.type === "region")));
      }
      children.push(anchor("footer", "region.footer", chromeContext(node, undefined)));
      return createElement(
        "div",
        {
          key: node.id,
          "data-prac-region": node.id,
          ...decoration?.attrs,
          ...(decoration?.ref === undefined ? {} : { ref: decoration.ref }),
          style: {
            ...regionStyle(node, dir, fill),
            ...decoration?.style,
          },
        } as unknown as DivAttributes,
        children,
      );
    }

    const paneHeader =
      views.length === 1 && state.views[views[0] ?? ""] !== undefined
        ? ownHeader?.(state.views[views[0]!]!, views[0]!) === true
        : false;
    const sashState: string =
      node.entry === true ? entrySashState(state, node.id, rowHeights) : "disabled";
    const activeItem = frontView(state, node.id) ?? views[0];
    const decoration = decorate?.({
      state,
      node,
      regionId: node.id,
      ...(activeItem === undefined ? {} : { itemId: activeItem }),
      ...(intents === undefined ? {} : { intents }),
      box,
      kind: "region",
    });

    const children: ReactNode[] = [
      anchor("frame", "region.frame", chromeContext(node, activeItem)),
    ];
    if (showsTabStrip(state, node)) {
      children.push(anchor("tabs", "region.tabs", chromeContext(node, activeItem)));
      children.push(keyed("item", itemContent(activeItem, box)));
    } else if (node.entry === true && views.length === 1) {
      const viewId = views[0]!;
      const record = state.views[viewId];
      const body =
        node.collapsed === true || record === undefined
          ? null
          : keyed(
              "body",
              createElement(
                "div",
                { "data-prac-stack-body": node.id, style: STACK_BODY_STYLE },
                keyed(
                  "item",
                  renderItem(record, viewId, box, paneHeader ? { chrome: "frame" } : undefined),
                ),
              ),
            );
      // A view with its own pane header owns the row title. The expanded row is just
      // the view plus the frame's fold/drag overlay; a folded row has no view, so the
      // frame's own header (with the declared title) is what remains.
      if (paneHeader) {
        if (node.collapsed === true)
          children.push(anchor("header", "row.header", chromeContext(node, viewId)));
        else children.push(body);
      } else {
        children.push(anchor("header", "row.header", chromeContext(node, viewId)));
        children.push(body);
      }
    } else {
      // No strip: the region still shows its **front** view. It used to take the
      // first by order, which is a different question — measured with a region a view
      // had just been split into: the file that was copied in was front, the
      // region rendered its neighbour, and the new file's view got no surface.
      children.push(keyed("item", itemContent(activeItem, box)));
    }
    children.push(anchor("footer", "region.footer", chromeContext(node, activeItem)));
    children.push(anchor("overlay", "region.overlay", chromeContext(node, views[0] ?? activeItem)));

    return createElement(
      "div",
      {
        key: node.id,
        "data-prac-region": node.id,
        ...decoration?.attrs,
        ...(node.entry === true
          ? {
              // A stack row is a region too: carry the entry markers so the frame's DOM-based
              // helpers (`readStackRows`, the reorder gesture, the gates) see a row where they
              // expect one.
              "data-prac-stack-entry": views[0] ?? "",
              "data-prac-stack-row": node.id,
              // The boundary under this row follows `SashState` (B2/B4): `Disabled` has no handle
              // or resize cursor; `AtMinimum`/`AtMaximum` keep the handle and a **directional**
              // cursor; `Enabled` is the ordinary resize. Readers ask with these markers.
              "data-prac-stack-handle": sashState === "disabled" ? "false" : "true",
              "data-prac-stack-sash-state": sashState,
              "data-prac-stack-collapsed": node.collapsed === true ? "true" : "false",
            }
          : {}),
        ...(decoration?.ref === undefined ? {} : { ref: decoration.ref }),
        ...(decoration?.onPointerDownCapture === undefined
          ? {}
          : { onPointerDownCapture: decoration.onPointerDownCapture }),
        ...(decoration?.onDoubleClick === undefined
          ? {}
          : { onDoubleClick: decoration.onDoubleClick }),
        ...(decoration?.onDragOver === undefined ? {} : { onDragOver: decoration.onDragOver }),
        ...(decoration?.onDragLeave === undefined ? {} : { onDragLeave: decoration.onDragLeave }),
        ...(decoration?.onDrop === undefined ? {} : { onDrop: decoration.onDrop }),
        style: {
          ...regionStyle(
            node,
            dir,
            fill,
            // A row is drawn at its allocated extent (C6/C8): the gain a region made belongs to one
            // row, and the allocation is what says which. Without an allocation (a board root) the
            // tree's own claim is what remains.
            node.entry === true ? sizes?.get(node.id)?.height : undefined,
          ),
          // The overlay is absolute inside its row; the row is the containing block.
          ...(node.entry === true && views.length === 1 && node.collapsed !== true && paneHeader
            ? { position: "relative" as const }
            : {}),
          ...decoration?.style,
        },
      } as unknown as DivAttributes,
      children,
    );
  };

  const renderSplitNode = (node: SplitNode): ReactElement => {
    const present = node.children.filter((child) => isPresent(state, child));
    const parts: ReactNode[] = [];
    // The sashes are absolutely positioned, so the children flow edge to edge and the boundary
    // offset is the sum of the extents before it (the allocation, not the DOM).
    let offset = 0;
    present.forEach((child, index) => {
      if (index > 0) {
        const before = edgeRegion(state, present[index - 1]!, "right");
        const after = edgeRegion(state, child, "left");
        if (before !== null && after !== null) {
          parts.push(
            anchor(
              `sash:${index}`,
              "split.sash",
              chromeContext(node, undefined, {
                index,
                offset,
                beforeId: before.id,
                afterId: after.id,
                box: sizes?.get(node.id) ?? ZERO_BOX,
              }),
            ),
          );
        }
      }
      parts.push(renderNode(child, node.dir));
      const childBox = sizes?.get(child.id);
      offset += node.dir === "row" ? (childBox?.width ?? 0) : (childBox?.height ?? 0);
    });
    const decoration = decorate?.({
      state,
      node,
      regionId: node.id,
      ...(intents === undefined ? {} : { intents }),
      box: sizes?.get(node.id) ?? ZERO_BOX,
      kind: "split",
    });
    return createElement(
      "div",
      {
        key: node.id,
        "data-prac-split": node.id,
        "data-prac-split-dir": node.dir,
        ...decoration?.attrs,
        ...(decoration?.ref === undefined ? {} : { ref: decoration.ref }),
        style: { ...splitStyle(node), ...decoration?.style },
      } as unknown as DivAttributes,
      parts,
    );
  };

  const renderGridNode = (node: GridNode, dir: Dir): ReactElement => {
    const cells = node.children.filter((child) => isPresent(state, child));
    const shape = gridShape(node, cells.length);
    const columnWeights = gridTrackWeights(node, "column", shape.columns);
    const rowWeights = gridTrackWeights(node, "row", shape.rows);
    const decoration = decorate?.({
      state,
      node,
      regionId: node.id,
      ...(intents === undefined ? {} : { intents }),
      box: sizes?.get(node.id) ?? ZERO_BOX,
      kind: "grid",
    });
    const parts: ReactNode[] = [];
    cells.forEach((child, index) => {
      // **Any** one-cell grid is transparent: no extra flex wrapper. The wrapper
      // only means something when there are sibling cells to place it against;
      // with one cell it becomes a flex item with no `flex` of its own, and the
      // cell then takes half the stage even though the grid says one column
      // (measured after closing a split editor: `center` 636px of a 1272px stage).
      if (cells.length <= 1) {
        parts.push(
          createElement(
            "div",
            {
              key: `cell:${child.id}`,
              "data-prac-grid-cell": child.id,
              style: { display: "contents" },
            },
            renderNode(child, dir),
          ),
        );
        return;
      }
      const placement = node.placements?.[child.id] ?? {
        row: Math.floor(index / shape.columns),
        column: index % shape.columns,
      };
      const cellBox = sizes?.get(child.id) ?? ZERO_BOX;
      const cellDecoration = decorate?.({
        state,
        node,
        regionId: node.id,
        itemId: child.id,
        ...(intents === undefined ? {} : { intents }),
        box: cellBox,
        index,
        child,
        placement,
        shape,
        cellCount: cells.length,
        kind: "cell",
      });
      parts.push(
        createElement(
          "div",
          {
            key: `cell:${child.id}`,
            "data-prac-grid-cell": child.id,
            ...cellDecoration?.attrs,
            ...(cellDecoration?.ref === undefined ? {} : { ref: cellDecoration.ref }),
            ...(cellDecoration?.onDragOver === undefined
              ? {}
              : { onDragOver: cellDecoration.onDragOver }),
            ...(cellDecoration?.onDrop === undefined ? {} : { onDrop: cellDecoration.onDrop }),
            style: {
              gridRow: `${placement.row + 1} / span ${placement.rowSpan ?? 1}`,
              gridColumn: `${placement.column + 1} / span ${placement.columnSpan ?? 1}`,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              position: "relative",
              ...cellDecoration?.style,
            },
          } as unknown as DivAttributes,
          anchor(
            `cell:${child.id}`,
            "grid.cell",
            chromeContext(node, child.id, {
              index,
              child,
              placement,
              shape,
              cellCount: cells.length,
              box: cellBox,
            }),
          ),
          renderNode(child, dir),
        ),
      );
    });
    columnWeights.slice(0, -1).forEach((_, index) => {
      parts.push(
        anchor(
          `track:column:${index}`,
          "grid.track",
          chromeContext(node, undefined, {
            index,
            track: "column",
            shape,
            cellCount: cells.length,
            box: sizes?.get(node.id) ?? ZERO_BOX,
          }),
        ),
      );
    });
    rowWeights.slice(0, -1).forEach((_, index) => {
      parts.push(
        anchor(
          `track:row:${index}`,
          "grid.track",
          chromeContext(node, undefined, {
            index,
            track: "row",
            shape,
            cellCount: cells.length,
            box: sizes?.get(node.id) ?? ZERO_BOX,
          }),
        ),
      );
    });
    return createElement(
      "div",
      {
        key: node.id,
        "data-prac-grid": node.id,
        ...decoration?.attrs,
        ...(decoration?.ref === undefined ? {} : { ref: decoration.ref }),
        style: { ...gridStyle(node, cells.length), ...decoration?.style },
      } as unknown as DivAttributes,
      parts,
    );
  };

  return createElement(
    Fragment,
    null,
    renderNode(props.root ?? state.tree, props.dir ?? "row", props.fill === true),
  );
}

/** Visible views in a region, for callers that need the item ids as well. */
export function regionItems<TRecord extends PlacementRecord>(
  state: LayoutState<TRecord>,
  regionId: string,
): string[] {
  return visibleViews(state, regionId);
}

/** The effective placement of one grid cell (flow position when none is recorded). */
export function cellPlacement(
  node: GridNode,
  childId: string,
  index: number,
  columns: number,
): GridPlacement {
  return (
    node.placements?.[childId] ?? {
      row: Math.floor(index / Math.max(1, columns)),
      column: index % Math.max(1, columns),
    }
  );
}
