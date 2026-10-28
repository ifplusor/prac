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
 * - **the recall surface** in `shell.overlay`: the mechanism's view catalogue
 *   made reachable (聚焦 / 隐藏·显示 / 移到 / 分到上·下·左·右 / 收起);
 * - **keybindings** for the cheap moves.
 *
 * It has no region rendering and no sash mechanics: the frame, the region tree
 * and the drag/collapse behaviour are `ui-frame`'s. Every placement goes
 * through `ctx.pracFrame`; every view is rendered by the mechanism, including the
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
import { PracChangedFiles, type ChangedFilesInjected } from "prac-client-ui-changed-files/client";
import { PracFirstRun, PRAC_FIRST_RUN_CSS } from "./first-run.js";
import {
  PracRail,
  PracTitleBar,
  PRAC_SHELL_CSS,
  type PracLayoutAction,
  type PracRailFace,
  type PracRailItem,
  type PracTitleFace,
} from "./title-bar.js";
import type { ReactElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SlotMap } from "@deepseek-ai/dsh-client-ui-slots";
// Type-only, for its declarations: `ui-renderer` owns `Context.slots` (its `SlotRegistry`),
// and naming the plugin whose service this file drives is what puts that member — and the
// registration surface hanging off it — in this program. The slot *keys* are declared by
// whichever package owns them (the mechanism declares the `root` children it registers,
// including `shell.overlay`), so nothing here re-imports a key's owner for comparison.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { LayoutState, Side } from "prac-client-ui-frame/lib";
// Types only, for its `Context` merge (`ctx.pracVscode`): the arrangement follows
// the app's open-file set, and naming the face puts that service in this program.
import type {} from "prac-client-vscode-host/client";
import {
  CENTER,
  DSH_CONVERSATION_VIEW,
  LEFT,
  RIGHT,
  arrange,
  openFileInto,
  placeCatalogue,
  restoreCentre,
  staleFileViews,
  type PracLayout,
} from "./arrangement.js";

/**
 * The overlay slot this arrangement puts its own two surfaces into.
 *
 * `satisfies` keeps the literal type (a union-typed key breaks `register`'s
 * inference) while still checking that DSH declares this key.
 */
const OVERLAY = "shell.overlay" satisfies keyof SlotMap;

/** The DSH turn-tail seat the changed-files card claims. */
const CHANGED_FILES_SLOT = "conversation.chat.turnTail" as keyof SlotMap;

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
   * several files open, "forward" also means "this is the active file",
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
  /** A catalogue row is being dragged; make the panel translucent so cells are reachable. */
  const [dragging, setDragging] = useState(false);
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
        draggable: true,
        onDragStart: (event: {
          readonly dataTransfer: {
            setData(type: string, value: string): void;
            effectAllowed: string;
          } | null;
          readonly preventDefault: () => void;
        }) => {
          if (event.dataTransfer === null) return;
          event.dataTransfer.setData("text/prac-view", view.id);
          event.dataTransfer.effectAllowed = "move";
          setDragging(true);
        },
        onDragEnd: () => setDragging(false),
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
      "data-prac-recall-dragging": dragging ? "true" : "false",
      tabIndex: -1,
      onKeyDown: onPanelKeyDown,
      style: {
        ...RECALL_PANEL_STYLE,
        outline: "none",
        opacity: dragging ? 0.2 : 1,
        pointerEvents: dragging ? "none" : undefined,
      },
    },
    header,
    ...rows,
    regionBar,
  );
}

/**
 * One action for the conversation view, rendered by the frame's
 * `prac.viewActions` slot.
 *
 * This is the arrangement's action, not a VS Code menu: the frame owns the row
 * header, the view owner supplies the actions, and the two only meet through
 * the slot.
 *
 * @param props - the action to run.
 */
function ConversationAction({ onShow }: { onShow: () => void }): ReactElement {
  return createElement(
    "button",
    {
      type: "button",
      "data-prac-view-action": "conversation",
      title: "Bring the conversation forward",
      "aria-label": "Bring the conversation forward",
      onClick: onShow,
      style: {
        font: "inherit",
        fontSize: "12px",
        lineHeight: "1",
        height: "100%",
        padding: "0 6px",
        border: 0,
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      },
    },
    "对话",
  );
}

/**
 * Apply the arrangement: default placements, roles, the strip, the recall
 * surface and the keys.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The two services this arrangement drives: the mechanism's placement face, and the layout
  // face it publishes as a compat shim. Both are read off the **augmented `Context`** and
  // deliberately not re-imported for comparison — a slot table's keys come from the package
  // that *owns* them (the mechanism declares the `root` children it registers, including
  // `shell.overlay` below), so this file needs no DSH slot/layout types of its own.
  const layout = ctx.pracFrame as unknown as PracLayout;
  const slots = ctx.slots;
  // The title bar's Layout menu is built by the catalogue inject (it needs the app's containers);
  // the title bar itself only renders what this answers when the menu opens.
  let layoutMenu: () => readonly PracLayoutAction[] = () => [];

  // The DSH changed-files card opens the review tab; prac replaces it with the
  // turn-scoped diff card below. Hide the DSH card by its stable marker, not by
  // a hashed CSS class.
  const changedFilesStyle = document.createElement("style");
  changedFilesStyle.dataset.prac = "changed-files";
  changedFilesStyle.textContent = CHANGED_FILES_CSS;
  document.head.append(changedFilesStyle);
  ctx.effect(() => () => changedFilesStyle.remove(), "prac-web-app: changed-files styles");

  // The shell chrome: title bar, vertical activity rail, hidden DSH sidebar,
  // and bottom panel. The DSH sidebar's rows are shown by the title bar's
  // switchers; the left rail is the VS Code container bar.
  const shellStyle = document.createElement("style");
  shellStyle.dataset.prac = "shell";
  shellStyle.textContent = PRAC_SHELL_CSS;
  document.head.append(shellStyle);
  ctx.effect(() => () => shellStyle.remove(), "prac-web-app: shell styles");

  const firstRunStyle = document.createElement("style");
  firstRunStyle.dataset.prac = "first-run";
  firstRunStyle.textContent = PRAC_FIRST_RUN_CSS;
  document.head.append(firstRunStyle);
  ctx.effect(() => () => firstRunStyle.remove(), "prac-web-app: first-run styles");
  arrange(layout);

  // The title bar reads the same Workspace/Session controllers the hidden DSH
  // sidebar used and delegates selection to `uiWorkspace`. The services are not
  // in this bundle's type graph; this is the one structural boundary.
  interface TitleServices {
    workspaces: PracTitleFace["workspaces"];
    sessions: PracTitleFace["sessions"];
    uiSession: PracTitleFace["uiSession"];
    pracSpaces: PracTitleFace["spaces"];
    uiWorkspace: {
      openSession(sessionId: string): void;
      openWorkspace(workspaceId: string): Promise<void>;
      startSession(workspaceId?: string): void;
    };
    slots: typeof slots;
  }
  ctx.inject(["workspaces", "sessions", "uiSession", "uiWorkspace", "pracSpaces"], (titleCtx) => {
    const titleServices = titleCtx as unknown as TitleServices;
    const face: PracTitleFace = {
      workspaces: titleServices.workspaces,
      sessions: titleServices.sessions,
      uiSession: titleServices.uiSession,
      openSession: (sessionId) => titleServices.uiWorkspace.openSession(sessionId),
      openWorkspace: (workspaceId) => titleServices.uiWorkspace.openWorkspace(workspaceId),
      openWorkspaceFolder: (path) => {
        // The code server is long-running; the browser page opens a folder. The
        // IDE boot reads `workspace` first, so this reload is the actual switch.
        const params = new URLSearchParams(window.location.search);
        params.set("workspace", path);
        window.location.replace(`${window.location.pathname}?${params.toString()}`);
      },
      startSession: (workspaceId) => titleServices.uiWorkspace.startSession(workspaceId),
      layoutActions: () => layoutMenu(),
      spaces: titleServices.pracSpaces,
    };
    const inject = titleServices.slots.inject.bind(titleServices.slots) as unknown as (
      name: string,
      callback: () => unknown,
    ) => void;
    const register = titleServices.slots.register.bind(titleServices.slots) as unknown as (
      options: { name: string; id: string; order?: number },
      component: () => unknown,
    ) => unknown;
    inject("shell.overlay", () =>
      register({ name: "shell.overlay", id: "prac-titlebar", order: -10 }, () =>
        createElement(PracTitleBar, { face }),
      ),
    );
    inject("shell.overlay", () =>
      register({ name: "shell.overlay", id: "prac-firstrun", order: -20 }, () =>
        createElement(PracFirstRun, { face }),
      ),
    );
  });

  /** Every file view the app has open, and the file resources behind them. */
  let fileViews = new Set<string>();
  let fileResources = new Set<string>();

  // The app opens files itself (an explorer click, a command, a jump), so the
  // arrangement follows the app's catalogue instead of a fixed editor view: file
  // entries drive the active window and the centre, view entries are placed by their own
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
        if (leftTheScreen) {
          // The last file just *left*: give the centre back to the conversation.
          // Gated on that event deliberately — a frame that merely boots with no
          // file open must not overrule an arrangement the user persisted.
          restoreCentre(layout);
          layout.show(DSH_CONVERSATION_VIEW);
        }
        return;
      }
      const opened = files.find((entry) => appeared.includes(entry.appId));
      if (opened === undefined) return;
      // A file the app opened comes forward in the centre window group; the
      // window group's tab strip is the switch, so the conversation stays a tab.
      openFileInto(layout, opened.view);
    };
    sync();
    scope.effect(() => vscode.onDidChangeCatalogue(sync), "prac-web-app: app catalogue");

    const railSubscribe = (listener: () => void): (() => void) => {
      const offLayout = layout.subscribe(listener);
      const offCatalogue = vscode.onDidChangeCatalogue(listener);
      return () => {
        offLayout();
        offCatalogue();
      };
    };
    /** One item per container the app offers in a location, in catalogue order. */
    const containerItems = (
      location: "sidebar" | "auxiliarybar",
    ): { id: string; label: string; view: string }[] => {
      const groups = new Map<string, { label: string; view: string }>();
      for (const entry of vscode.catalogue()) {
        if (entry.source !== "view" || entry.containerId === undefined) continue;
        if (entry.location !== location) continue;
        if (!groups.has(entry.containerId)) {
          groups.set(entry.containerId, {
            label: entry.containerTitle ?? entry.title,
            view: entry.view,
          });
        }
      }
      return [...groups.entries()].map(([id, group]) => ({ id, ...group }));
    };

    const viewForChild = (childId: string): string | undefined => {
      const container = /\/container:(.+)$/.exec(childId)?.[1];
      if (container !== undefined) {
        return vscode
          .catalogue()
          .find((entry) => entry.source === "view" && entry.containerId === container)?.view;
      }
      // A child of its own is named after the view (`right/<view id>`).
      const slash = childId.indexOf("/");
      const direct = slash < 0 ? childId : childId.slice(slash + 1);
      return direct.includes(":") ? direct : undefined;
    };
    /** A dock's tool windows: the children the arrangement put in that region. */
    const dockItems = (regionId: string): PracRailItem[] =>
      layout.regionChildren(regionId).map((child) => ({
        id: child.id,
        label: child.label ?? child.id.split("/").pop() ?? child.id,
        active: layout.activeContainer(regionId) === child.id,
      }));

    const leftRail: PracRailFace = {
      // The left rail is the workspace's containers, which the app's catalogue names — that is the
      // same list the dock's children are built from, and it keeps an empty container (Run and
      // Debug) reachable even while its only view is off screen.
      items: () => {
        // A container moved to the right dock is the right rail's item now; listing it on the left
        // too would be a dead button. (An unplaced container such as Run and Debug stays: it has no
        // views anywhere, so moving it is not a state the left rail can lose it in.)
        const placedRight = new Set(
          layout
            .listViews()
            .filter(
              (view) =>
                view.region !== null &&
                (view.region === RIGHT || view.region.startsWith(`${RIGHT}/`)),
            )
            .map((view) => view.id),
        );
        const moved = new Set(
          vscode
            .catalogue()
            .filter((entry) => entry.containerId !== undefined && placedRight.has(entry.view))
            .map((entry) => entry.containerId),
        );
        return containerItems("sidebar")
          .filter((item) => !moved.has(item.id))
          .map((item) => ({
            id: item.id,
            label: item.label,
            active: layout.activeContainer(LEFT) === `left/container:${item.id}`,
          }));
      },
      onDidChange: railSubscribe,
      select: (id) => {
        // The rail names a container, not a view: select the container child first, then front the
        // view inside it. Both are layout operations — no click on a hidden strip.
        layout.selectContainer(LEFT, `left/container:${id}`);
        const entry = vscode.catalogue().find((candidate) => candidate.containerId === id);
        if (entry !== undefined) layout.show(entry.view);
      },
    };

    const rightRail: PracRailFace = {
      items: (): PracRailItem[] => {
        const items: PracRailItem[] = [];
        const conversation = layout.getState().views[DSH_CONVERSATION_VIEW];
        const region = conversation?.region ?? null;
        const inDock = region === RIGHT || (region !== null && region.startsWith(`${RIGHT}/`));
        const maximized = region === CENTER || (region !== null && region.startsWith(`${CENTER}/`));
        // The agent is a tool window like the others, but it is always in the rail: its home is the
        // right dock, and while no editor holds the area it is **maximized** there (the rail marks
        // that with a dot instead of the active state).
        items.push({
          id: "chat",
          label: "Chat",
          active: inDock && (region === RIGHT || layout.activeContainer(RIGHT) === (region ?? "")),
          maximized,
        });
        for (const item of dockItems(RIGHT)) {
          // A child named after the conversation is the same tool window, already listed.
          if (item.id === `${RIGHT}/${DSH_CONVERSATION_VIEW}` || item.id === DSH_CONVERSATION_VIEW)
            continue;
          items.push(item);
        }
        return items;
      },
      onDidChange: railSubscribe,
      select: (id) => {
        if (id === "chat") {
          // Showing it must not drag it out of the editor area: maximize is a placement the app
          // chooses (no file → editor area), not something a rail click undoes. When it is docked,
          // select its child (a sibling tool window may be the visible one) and reveal the dock.
          const region = layout.getState().views[DSH_CONVERSATION_VIEW]?.region ?? null;
          if (region === RIGHT || (region !== null && region.startsWith(`${RIGHT}/`))) {
            if (region !== RIGHT) layout.selectContainer(RIGHT, region);
            layout.setCollapsed(RIGHT, false);
          }
          layout.show(DSH_CONVERSATION_VIEW);
          return;
        }
        layout.setCollapsed(RIGHT, false);
        layout.selectContainer(RIGHT, id);
        const view = viewForChild(id);
        if (view !== undefined) layout.show(view);
      },
    };

    /** Move a container's tool window from one dock to the other, preserving its views. */
    const moveContainer = (containerId: string, from: "left" | "right"): void => {
      const target = from === "left" ? RIGHT : LEFT;
      const views = vscode
        .catalogue()
        .filter((entry) => entry.source === "view" && entry.containerId === containerId);
      if (views.length === 0) return;
      const label = views[0]?.containerTitle ?? views[0]?.title ?? containerId;
      const targetChild = `${target}/container:${containerId}`;
      // A direct view in the target (chat parked in the right dock) must get a child of its own
      // before the region becomes a selector, or the new child would hide it.
      const chat = layout.getState().views[DSH_CONVERSATION_VIEW];
      const chatChild = `${RIGHT}/${DSH_CONVERSATION_VIEW}`;
      if (
        target === RIGHT &&
        chat?.region === RIGHT &&
        !layout.regionChildren(RIGHT).some((child) => child.id === chatChild)
      ) {
        layout.setRegionChildren(RIGHT, [{ id: chatChild, label: "Chat" }]);
        layout.place(DSH_CONVERSATION_VIEW, chatChild);
      }
      const existing = layout.regionChildren(target).filter((child) => child.id !== targetChild);
      layout.setRegionChildren(target, [...existing, { id: targetChild, label }]);
      layout.setCollapsed(target, false);
      for (const entry of views) layout.place(entry.view, targetChild);
      const remaining = layout
        .regionChildren(from)
        .filter((child) => child.id !== `${from}/container:${containerId}`);
      layout.setRegionChildren(from, remaining);
      layout.selectContainer(target, targetChild);
    };

    /** The collapsed flag of a region, if it is in the tree. */
    const collapsedOf = (node: LayoutState["tree"], id: string): boolean | undefined => {
      if (node.id === id && node.type === "region") return node.collapsed;
      for (const child of node.children ?? []) {
        const found = collapsedOf(child, id);
        if (found !== undefined) return found;
      }
      return undefined;
    };

    /** The Layout menu: every placed container that can move to the other dock. */
    layoutMenu = () => {
      const actions: PracLayoutAction[] = [];
      for (const child of layout.regionChildren(LEFT)) {
        const containerId = /\/container:(.+)$/.exec(child.id)?.[1];
        if (containerId === undefined) continue;
        actions.push({
          id: `move:left:${containerId}`,
          label: `Move ${child.label ?? containerId} to right dock`,
          run: () => moveContainer(containerId, "left"),
        });
      }
      for (const child of layout.regionChildren(RIGHT)) {
        if (child.id === `${RIGHT}/${DSH_CONVERSATION_VIEW}`) continue;
        const containerId = /\/container:(.+)$/.exec(child.id)?.[1];
        if (containerId === undefined) continue;
        actions.push({
          id: `move:right:${containerId}`,
          label: `Move ${child.label ?? containerId} to left dock`,
          run: () => moveContainer(containerId, "right"),
        });
      }
      // The rail stays when the dock folds: collapsing the right dock only takes its content away.
      const collapsed = collapsedOf(layout.getState().tree, RIGHT);
      actions.push({
        id: "dock:right",
        label: collapsed === true ? "Show right dock" : "Hide right dock",
        run: () => layout.setCollapsed(RIGHT, collapsed !== true),
      });
      return actions;
    };

    const registerActivity = scope.slots.inject.bind(scope.slots) as unknown as (
      name: string,
      callback: () => unknown,
    ) => void;
    const addActivity = scope.slots.register.bind(scope.slots) as unknown as (
      options: { name: string; id: string; order?: number },
      component: () => unknown,
    ) => unknown;
    registerActivity("shell.overlay", () =>
      addActivity({ name: "shell.overlay", id: "prac-activity", order: -9 }, () =>
        createElement(PracRail, { face: leftRail, side: "left" }),
      ),
    );
    registerActivity("shell.overlay", () =>
      addActivity({ name: "shell.overlay", id: "prac-activity-right", order: -9 }, () =>
        createElement(PracRail, { face: rightRail, side: "right" }),
      ),
    );

    // The turn-tail card. Its summary is the Host's existing changes summary;
    // its diff action is the turn-scoped text route plus the VSCode face. The
    // chat slot's types come from the DSH chat package, which this bundle does
    // not import; keep the cast at this one boundary.
    const injectChangedFiles = scope.slots.inject.bind(scope.slots) as unknown as (
      name: string,
      callback: () => unknown,
    ) => void;
    const registerChangedFiles = scope.slots.register.bind(scope.slots) as unknown as (
      options: {
        name: string;
        id: string;
        order?: number;
        inject: () => ChangedFilesInjected;
      },
      component: unknown,
    ) => unknown;
    injectChangedFiles(CHANGED_FILES_SLOT, () =>
      registerChangedFiles(
        {
          name: CHANGED_FILES_SLOT,
          id: "prac-changed-files",
          order: 20,
          inject: (): ChangedFilesInjected => ({
            openTurnDiff: (args) => vscode.runCommand("prac.openTurnDiff", args),
          }),
        },
        PracChangedFiles,
      ),
    );
  });

  /**
   * Bring a view forward, and remember it when it is a file: the strip's
   * "editor" door should lead back to the file the window group last showed.
   *
   * @param viewId - the view to bring forward.
   */
  const focusInto = (viewId: string): void => {
    layout.show(viewId);
  };

  // The environment layer: additive, and the only slot a prac surface of our
  // own may float in (registering into `root` would shadow the whole frame).
  // The conversation's action, in the frame's per-view header slot.
  slots.inject("prac.viewActions", () =>
    slots.register({ name: "prac.viewActions", key: DSH_CONVERSATION_VIEW }, () =>
      createElement(ConversationAction, { onShow: () => layout.show(DSH_CONVERSATION_VIEW) }),
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
}

/** Card styling plus the DSH card's marker. The tokens are DSH's; no second theme. */
const CHANGED_FILES_CSS = `
[data-changed-files]{display:none!important}
.prac-changed-files{margin-top:4px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}
.prac-cf-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--dsw-static-neutral-50);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;}
body[data-ds-dark-theme] .prac-cf-head{background:var(--dsw-static-neutral-850);}
.prac-cf-icon{display:grid;place-items:center;width:18px;height:18px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);font-weight:700;font-size:10px;color:var(--dsw-alias-label-secondary);}
.prac-cf-title{font-weight:600;}
.prac-cf-total{margin-left:auto;display:inline-flex;gap:6px;font-family:var(--ds-font-family-code);font-size:10px;color:var(--dsw-alias-label-tertiary);}
.prac-cf-add{color:var(--dsw-alias-state-success-primary);}
.prac-cf-del{color:var(--dsw-alias-state-error-primary);}
.prac-cf-list{display:flex;flex-direction:column;}
.prac-cf-row{display:flex;align-items:center;gap:10px;width:100%;min-width:0;padding:7px 10px;border:0;border-top:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-family:var(--ds-font-family-code);font-size:11px;text-align:left;cursor:pointer;}
.prac-cf-row:first-child{border-top:0;}
.prac-cf-row:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}
.prac-cf-row:disabled{cursor:default;opacity:.6;}
.prac-cf-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);}
.prac-cf-stat{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}
.prac-cf-foot{display:flex;gap:8px;padding:5px 10px;background:var(--dsw-static-neutral-50);color:var(--dsw-alias-label-tertiary);font-size:10px;}
body[data-ds-dark-theme] .prac-cf-foot{background:var(--dsw-static-neutral-850);}
.prac-cf-turn{font-family:var(--ds-font-family-code);}
.prac-cf-note{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
`;

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-workbench";

/**
 * The DSH services this plugin needs: the slot registry (the strip's slot) and
 * the mechanism's placement face. `pracFrame` is a hard dependency — every
 * placement goes through it.
 */
export const inject = ["slots", "layout", "pracFrame"];
