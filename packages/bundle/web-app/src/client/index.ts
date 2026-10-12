/**
 * prac-web-app — the bundle's arrangement: the client half.
 *
 * This is the **arrangement**, not the mechanism. It answers one question —
 * *what is on screen, and where* — and nothing else:
 *
 * - **default views and their placements**: which of DSH's slots and prac's own
 *   views start in which region ({@link DEFAULT_PLACEMENTS});
 * - **role binding**: which view plays the `sidebar` / `rightbar` role, so the
 *   borrowed `ctx.layout` vocabulary reaches a concrete view
 *   ({@link bindRoles});
 * - **the attention strip** in `shell.overlay` and the focus/back stack it
 *   drives;
 * - **the recall surface** in `shell.overlay`: the mechanism's view catalogue
 *   made reachable (聚焦 / 隐藏·显示 / 移到 / 分到上·下·左·右 / 收起);
 * - **keybindings** for the cheap moves.
 *
 * It has no region rendering and no sash mechanics: the frame, the region tree
 * and the drag/collapse behaviour are `prac-client-ui-layout`'s. Every placement goes
 * through `ctx.pracLayout`; every view is rendered by the mechanism, including the
 * file views the editor package (`prac-client-ui-vscode-editor`) registers through
 * the `prac.view` slot.
 *
 * This file is the plugin body as an ordinary ESM module (`name`, `inject`,
 * `apply`). DSH's closure-factory artifact (`window.__ModuleLoader__.load`) is
 * produced by the `pack` config in `vite.config.ts` (`scripts/pack-client.ts`);
 * only `react` stays
 * external (the loader's module table answers it).
 *
 * @module prac-web-app/client
 */

import { createElement, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { ILayout } from "@deepseek-ai/dsh-client-ui-layout/client";
import type { Side } from "prac-client-ui-layout/client";
// Types only, for its `Context` merge (`ctx.pracVscode`): the arrangement follows
// the app's open-file set, and naming the face puts that service in this program.
import type {} from "prac-client-vscode-host/client";
import {
  CONVERSATION,
  VSCODE_SURFACE,
  arrange,
  focusView,
  openFileInto,
  placeCatalogue,
  placeSurfaces,
  restoreCentre,
  staleFileViews,
  type PracLayout,
  type Surface,
} from "./arrangement.js";

/**
 * The overlay slot this arrangement puts its own two surfaces into.
 *
 * `satisfies` keeps the literal type (a union-typed key breaks `register`'s
 * inference) while still checking that DSH declares this key.
 */
const OVERLAY = "shell.overlay" satisfies keyof SlotMap;

/** The attention state the strip renders. */
interface FocusState {
  readonly current: Surface;
  readonly canGoBack: boolean;
}

/** The focus store: a stack, not a mode. */
interface FocusStore {
  state(): FocusState;
  subscribe(listener: (state: FocusState) => void): () => void;
  /** Move attention to a surface, pushing the previous one onto the stack. */
  focus(next: Surface): void;
  /** Return to the surface attention was on before. */
  back(): void;
}

/**
 * The surface the centre shows, plus where it was before.
 *
 * A stack rather than a mode: the two of us work in parallel, so switching what
 * you look at must stay a cheap, reversible act — not a state to declare or
 * maintain. Two surfaces today; the stack is what will make more of them
 * (a note, a diff, the activity stream) navigable later.
 *
 * @returns the focus store.
 */
function createFocus(): FocusStore {
  const listeners = new Set<(state: FocusState) => void>();
  const history: Surface[] = [];
  let current: Surface = CONVERSATION;

  const state = (): FocusState => ({ current, canGoBack: history.length > 0 });
  const emit = (): void => {
    // Iterate a snapshot: a listener may unsubscribe while we emit, and live
    // Set iteration would then skip the next listener.
    for (const listener of Array.from(listeners)) listener(state());
  };

  return {
    state,
    subscribe(listener: (next: FocusState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    focus(next: Surface): void {
      if (next === current) return;
      history.push(current);
      current = next;
      emit();
    },
    back(): void {
      const previous = history.pop();
      if (previous === undefined) return;
      current = previous;
      emit();
    },
  };
}

/** Props of the attention strip. */
interface FocusStripProps {
  focus: FocusStore;
  actions: { focus: (surface: Surface) => void; back: () => void };
}

/**
 * The ambient strip: an environment readout, not a mode selector.
 *
 * It says where attention is and offers the cheap moves. Registered into
 * `shell.overlay` — a list slot, so it is additive and never displaces a view,
 * and the layer is click-through until an entry opts into pointer events.
 *
 * @param props - the focus store and the actions the strip offers.
 */
function FocusStrip({ focus, actions }: FocusStripProps): ReactElement {
  const [state, setState] = useState<FocusState>(focus.state());
  useEffect(() => focus.subscribe(setState), []);
  const pill = (
    label: string,
    active: boolean,
    enabled: boolean,
    onClick: () => void,
  ): ReactElement =>
    createElement(
      "button",
      {
        onClick,
        disabled: !enabled,
        style: {
          font: "inherit",
          fontSize: "12px",
          lineHeight: "1",
          padding: "5px 10px",
          border: 0,
          borderRadius: "999px",
          cursor: enabled ? "pointer" : "default",
          background: active ? "rgba(127,127,127,0.30)" : "transparent",
          color: "inherit",
          opacity: enabled ? 1 : 0.45,
        },
      },
      label,
    );
  return createElement(
    "div",
    {
      "data-prac-focus-strip": state.current,
      style: {
        position: "absolute",
        left: "50%",
        bottom: "14px",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "3px",
        borderRadius: "999px",
        border: "1px solid rgba(127,127,127,0.28)",
        background: "rgba(127,127,127,0.12)",
        backdropFilter: "blur(6px)",
      },
    },
    pill("对话", state.current === CONVERSATION, state.current !== CONVERSATION, () =>
      actions.focus(CONVERSATION),
    ),
    pill("工件", state.current === VSCODE_SURFACE, state.current !== VSCODE_SURFACE, () =>
      actions.focus(VSCODE_SURFACE),
    ),
    pill("↩", false, state.canGoBack, actions.back),
  );
}

/** The placement face this half uses, as `prac-client-ui-layout` provides it. */
/** Where the recall surface's 聚焦 puts a view: the main work area. */

/**
 * The recall surface's restrained chrome, shared so every control matches the
 * attention strip rather than growing a second visual language.
 */
const RECALL_PANEL_STYLE = {
  position: "absolute",
  left: "50%",
  top: "14px",
  transform: "translateX(-50%)",
  width: "min(760px, calc(100% - 32px))",
  maxHeight: "72vh",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  padding: "8px 10px",
  borderRadius: "12px",
  border: "1px solid rgba(127,127,127,0.30)",
  background: "rgba(127,127,127,0.18)",
  backdropFilter: "blur(8px)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
  fontSize: "12px",
  color: "inherit",
} as const;

/** One recall control (a small translucent button). */
const RECALL_BUTTON_STYLE = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  padding: "4px 8px",
  border: "1px solid rgba(127,127,127,0.30)",
  borderRadius: "6px",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;

/** A row's region/move control. */
const RECALL_SELECT_STYLE = {
  font: "inherit",
  fontSize: "11px",
  lineHeight: "1",
  padding: "3px 4px",
  border: "1px solid rgba(127,127,127,0.30)",
  borderRadius: "6px",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
} as const;

/**
 * The four sides a view can be split out to, in reading order.
 *
 * One entry per direction rather than an axis plus a sign: the arrow and the
 * title are what a person reads, and `Side` is the same word the mechanism
 * takes, so nothing here translates between two geometries.
 */
const SPLIT_SIDES: readonly {
  readonly side: Side;
  readonly glyph: string;
  readonly title: string;
}[] = [
  { side: "left", glyph: "←", title: "分到左侧" },
  { side: "up", glyph: "↑", title: "分到上方" },
  { side: "down", glyph: "↓", title: "分到下方" },
  { side: "right", glyph: "→", title: "分到右侧" },
];

/** Props of the recall surface. */
interface RecallSurfaceProps {
  layout: PracLayout;
  /**
   * Bring a view forward (the surface's 聚焦). Supplied by the arrangement: with
   * several files open, "forward" also means "this is the file attention is on",
   * and that is arrangement state.
   */
  onFocus: (viewId: string) => void;
}

/**
 * The recall surface: the frame's view catalogue, made reachable from the UI.
 *
 * An overlay in `shell.overlay` (additive, click-through until it renders), it
 * answers the question the layout spec left open — *where did a view go, and how
 * do I get it back?* It lists every view the mechanism knows (including ones
 * nothing has placed), where each sits, and offers the mechanism's own moves:
 * 聚焦 (`place` into the console), 隐藏/显示 (`hide`/`show`), 移到 (`place` into
 * any region from `listRegions()`), 分到上/下/左/右 (`splitView`, per view — the
 * mechanism creates the pane *for* that view, so no direction can leave an empty
 * pane behind), and 收起/展开 (`setCollapsed`) per region.
 *
 * `Cmd/Ctrl+Alt+V` toggles it; `Escape` dismisses it; while it holds focus the
 * arrow keys move the cursor and `Enter` runs the cursor row's 聚焦. The
 * modifier combo is deliberately awkward to type, so it cannot bite while
 * writing — and the plain keys are handled on the panel, never document-wide.
 *
 * The catalogue is re-read on every layout store change, so a `main` panel or a
 * `prac.view` entry registered later is offered without a reload.
 *
 * @param props - the mechanism's placement face.
 */
function RecallSurface({ layout, onFocus }: RecallSurfaceProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /**
   * The open state, readable from the key listener below.
   *
   * The listener is registered once (it handles keys the panel cannot see yet);
   * a listener that closed over `open` would read the value from the render that
   * registered it, so `Escape` could never dismiss the surface on its first open.
   */
  const openRef = useRef(false);

  // Re-render on every accepted layout update: state identity changes on each
  // one, so the catalogue below is always read fresh.
  useSyncExternalStore(
    (listener) => layout.subscribe(listener),
    () => layout.getState(),
    () => layout.getState(),
  );
  const views = layout.listViews();
  const regions = layout.listRegions();
  const active = views.length === 0 ? 0 : Math.min(cursor, views.length - 1);

  // Toggle and dismiss are document-wide, so the surface can be summoned
  // without a mouse. `event.code` is what makes Cmd/Ctrl+Alt+V work on macOS,
  // where Option+V types "√" and changes `event.key`.
  //
  // `capture: true` on `window` is load-bearing for `Escape`: the VS Code side
  // registers a capture-phase key handler on `document` that consumes the key
  // before any bubble listener sees it (`window` capture runs first, so claiming
  // it here is what makes the dismissal reachable). Only while the surface is
  // open is Escape intercepted, so the editor keeps its own Escape otherwise.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const combo = (event.metaKey || event.ctrlKey) && event.altKey;
      if (combo && (event.code === "KeyV" || event.key.toLowerCase() === "v")) {
        event.preventDefault();
        setCursor(0);
        setOpen((current) => {
          openRef.current = !current;
          return !current;
        });
        return;
      }
      if (openRef.current && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        openRef.current = false;
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  // The panel takes focus so the plain arrow/Enter keys act on the catalogue,
  // never on the composer or the editor sitting underneath.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  /**
   * Arrow keys move the cursor; `Enter` runs the cursor row's primary action.
   * Keys that reach an already-focused control are left to that control, so a
   * click on 隐藏 is not doubled by the panel's own `Enter` handling.
   *
   * @param event - the panel's key event.
   */
  const onPanelKeyDown = (event: {
    readonly key: string;
    readonly target?: { readonly tagName?: string };
    preventDefault(): void;
  }): void => {
    const interactive = event.target?.tagName === "BUTTON" || event.target?.tagName === "SELECT";
    if (interactive) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor(Math.min(active + 1, Math.max(views.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      const row = views[active];
      if (!row) return;
      event.preventDefault();
      onFocus(row.id);
    }
  };

  const header = createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        padding: "0 4px 6px",
        opacity: 0.85,
      },
    },
    createElement("span", {}, "视图"),
    createElement(
      "span",
      { style: { fontSize: "11px", opacity: 0.7 } },
      "⌘/Ctrl+Alt+V 开关 · ↑↓ 选择 · Enter 聚焦 · Esc 关闭",
    ),
  );

  const rows = views.map((view, index) =>
    createElement(
      "div",
      {
        key: view.id,
        "data-prac-recall-row": view.id,
        "data-prac-recall-selected": index === active ? "" : undefined,
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "3px 6px",
          borderRadius: "8px",
          background: index === active ? "rgba(127,127,127,0.22)" : "transparent",
        },
      },
      createElement(
        "span",
        {
          "data-prac-recall-view": view.id,
          style: {
            flex: "1 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          },
        },
        view.id,
      ),
      createElement(
        "span",
        {
          "data-prac-recall-where": view.id,
          "data-prac-recall-hidden": view.hidden ? "true" : "false",
          style: { flex: "0 0 90px", textAlign: "right", opacity: view.hidden ? 0.6 : 1 },
        },
        view.region === null ? "隐藏" : view.hidden ? `${view.region} · 隐藏` : view.region,
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-prac-recall-focus": view.id,
          onClick: () => onFocus(view.id),
          style: RECALL_BUTTON_STYLE,
        },
        "聚焦",
      ),
      createElement(
        "button",
        {
          type: "button",
          "data-prac-recall-toggle": view.id,
          "data-prac-recall-visible": view.hidden ? "false" : "true",
          onClick: () => (view.hidden ? layout.show(view.id) : layout.hide(view.id)),
          style: RECALL_BUTTON_STYLE,
        },
        view.hidden ? "显示" : "隐藏",
      ),
      createElement(
        "select",
        {
          "data-prac-recall-move": view.id,
          "aria-label": `移到 ${view.id}`,
          value: view.region ?? "",
          onChange: (event: { readonly target: { readonly value: string } }) =>
            layout.place(view.id, event.target.value),
          style: RECALL_SELECT_STYLE,
        },
        view.region === null
          ? createElement("option", { key: "", value: "", disabled: true }, "移到…")
          : null,
        ...regions.map((region) =>
          createElement("option", { key: region.id, value: region.id }, region.id),
        ),
      ),
      // Splitting is a *view* verb (决定 15/20): the view moves into a region the
      // mechanism creates for it, so no direction can leave an empty region
      // behind. Disabled only while unplaced — there is no region to split then.
      ...SPLIT_SIDES.map(({ side, glyph, title }) =>
        createElement(
          "button",
          {
            key: side,
            type: "button",
            "data-prac-recall-split": `${view.id}:${side}`,
            title,
            "aria-label": `${view.id} ${title}`,
            disabled: view.region === null,
            onClick: () => layout.splitView(view.id, side),
            style: RECALL_BUTTON_STYLE,
          },
          glyph,
        ),
      ),
    ),
  );

  const regionBar = createElement(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "6px",
        marginTop: "6px",
        paddingTop: "6px",
        borderTop: "1px solid rgba(127,127,127,0.22)",
      },
    },
    createElement("span", { style: { fontSize: "11px", opacity: 0.7 } }, "区域"),
    ...regions.map((region) =>
      createElement(
        "span",
        {
          key: region.id,
          "data-prac-recall-region": region.id,
          style: { display: "flex", alignItems: "center", gap: "4px" },
        },
        createElement(
          "span",
          {
            style: {
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              opacity: 0.8,
            },
          },
          region.id,
        ),
        createElement(
          "button",
          {
            type: "button",
            "data-prac-recall-collapse": region.id,
            "data-prac-recall-collapsed": region.collapsed ? "true" : "false",
            onClick: () => layout.setCollapsed(region.id, !region.collapsed),
            style: RECALL_BUTTON_STYLE,
          },
          region.collapsed ? "展开" : "收起",
        ),
      ),
    ),
  );

  return createElement(
    "div",
    {
      ref: panelRef,
      "data-prac-recall": "",
      tabIndex: -1,
      onKeyDown: onPanelKeyDown,
      style: { ...RECALL_PANEL_STYLE, outline: "none" },
    },
    header,
    ...rows,
    regionBar,
  );
}

/**
 * Apply the arrangement: default placements, roles, the strip, the recall
 * surface and the keys.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The two services this arrangement drives, named through their published
  // types: the mechanism's placement face and DSH's layout face (which the
  // mechanism publishes as a compat shim).
  const layout: PracLayout = ctx.pracLayout;
  const slots: SlotRegistry = ctx.slots;
  // The seam this arrangement sits on, stated once: the mechanism publishes DSH's
  // layout face (the shim DSH's own plugins call), and importing that face is also
  // what puts DSH's own slot keys in this program — `shell.overlay`, which the two
  // surfaces below register into. `satisfies` is not erased: the expression is
  // evaluated, so `layout` is a declared injection below.
  ctx.layout satisfies ILayout;
  const focus = createFocus();
  arrange(layout);

  /**
   * The file view attention currently rests on, every file view the app has open, and
   * the file **resources** behind them.
   *
   * Two sets because they answer two questions: a *view* is a placement (a file in one
   * region, so the app splitting a file makes a second one), while a *resource* is a
   * file — and "the app opened a file" is the event that pulls attention back to the
   * editor. Reading the placement set for that pulled attention back every time the app
   * showed an already-open file somewhere else (a split), which undid the split.
   */
  let currentFile: string | null = null;
  let fileViews = new Set<string>();
  let fileResources = new Set<string>();

  // Attention moved: derive the placement. With several files open, "the editor"
  // means the one attention last rested on.
  focus.subscribe(() => placeSurfaces(layout, focus.state().current, currentFile));

  // The app opens files itself (an explorer click, a command, a jump), so the
  // arrangement follows the app's catalogue instead of a fixed editor view: file
  // entries drive attention and the centre, view entries are placed by their own
  // location (with the arrangement's exclusions).
  ctx.inject(["pracVscode"], (scope) => {
    const vscode = scope.pracVscode;
    const sync = (): void => {
      const catalogue = vscode.catalogue();
      const files = catalogue.filter((entry) => entry.source === "file");
      const resources = new Set(files.map((entry) => entry.appId));
      const appeared = [...resources].filter((resource) => !fileResources.has(resource));
      fileViews = new Set(files.map((entry) => entry.view));
      fileResources = resources;
      // Views the app offers get their default region here; the ones already
      // placed (or excluded) are left where they are. A file placement's default is
      // the region the app reports, or — when the app has not shown it yet — the
      // centre, or beside the file's other placement.
      placeCatalogue(layout, catalogue);
      // Files the app no longer has open are **forgotten**: their record is what the
      // frame persists, a placement is named by the host (so the next open mints a fresh
      // name), and a record left behind would both render a tab for a file nobody has open
      // and block the new placement from being shown.
      const records = layout.getState().views;
      let leftTheScreen = false;
      for (const view of staleFileViews(records, fileViews, (id) => vscode.fileResource(id))) {
        if (records[view]?.hidden !== true) leftTheScreen = true;
        layout.removeView(view);
      }
      if (files.length === 0) {
        currentFile = null;
        if (leftTheScreen) {
          // The editor surface just *left*: attention returns to the conversation
          // and the centre is the conversation's again. Gated on that event
          // deliberately — a frame that merely boots with no file open must not
          // overrule an arrangement the user persisted (the chat parked in the
          // bottom bar, a split of its own), which is what a bare "no files ⇒
          // centre the chat" rule did.
          focus.focus(CONVERSATION);
          restoreCentre(layout);
        }
        return;
      }
      // The view attention rests on: the first placement of the file the app just
      // opened. A file that merely gained a second placement (a split) is not a file
      // it just opened, and the new view must not take attention from the one the
      // person is working in.
      if (currentFile === null || !fileViews.has(currentFile)) {
        currentFile = files[0]?.view ?? null;
      }
      const opened = files.find((entry) => appeared.includes(entry.appId));
      if (opened === undefined) return;
      // A file the app opened comes forward, and **attention follows it**: the
      // strip must not read "conversation" while a file holds the centre (and
      // with attention already claimed to be on the conversation, pressing that
      // very key would do nothing, since `focus` ignores a no-op change).
      currentFile = opened.view;
      const surface = focus.state().current;
      focus.focus(VSCODE_SURFACE);
      if (focus.state().current === surface) {
        // Attention was already on the editor, so no subscription ran: placing
        // the *new* file is this call's job.
        openFileInto(layout, currentFile);
      }
    };
    sync();
    scope.effect(() => vscode.onDidChangeCatalogue(sync), "prac-web-app: app catalogue");
  });

  /**
   * Bring a view forward, and remember it when it is a file: the strip's
   * "editor" door should lead back to the file attention was last on.
   *
   * @param viewId - the view to bring forward.
   */
  const focusInto = (viewId: string): void => {
    if (fileViews.has(viewId)) currentFile = viewId;
    focusView(layout, viewId);
  };

  // The environment layer: additive, and the only slot a prac surface of our
  // own may float in (registering into `root` would shadow the whole frame).
  slots.inject(OVERLAY, () =>
    slots.register({ name: OVERLAY, id: "prac-focus" }, () =>
      createElement(FocusStrip, {
        focus,
        actions: {
          focus: (surface: Surface) => focus.focus(surface),
          back: () => focus.back(),
        },
      }),
    ),
  );

  // The recall surface: the same slot, a second additive entry, so the strip
  // keeps working untouched. It owns its own keybinding (`Cmd/Ctrl+Alt+V`).
  slots.inject(OVERLAY, () =>
    slots.register({ name: OVERLAY, id: "prac-recall" }, () =>
      createElement(RecallSurface, { layout, onFocus: focusInto }),
    ),
  );

  // Keyboard, so the move is a reflex rather than a reach for the mouse.
  // Cmd/Ctrl+Alt is deliberately awkward to type, so it cannot bite while
  // writing in the editor or the composer.
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
    if (event.key === "1") focus.focus(CONVERSATION);
    else if (event.key === "2") focus.focus(VSCODE_SURFACE);
    else if (event.key === "ArrowLeft") focus.back();
    else return;
    event.preventDefault();
  });
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-web-app";

/**
 * The DSH services this plugin needs: the slot registry (the strip's slot) and
 * the mechanism's placement face. `pracLayout` is a hard dependency — every
 * placement goes through it.
 */
export const inject = ["slots", "layout", "pracLayout"];
