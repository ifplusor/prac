/**
 * prac's workspace/session title bar.
 *
 * The DSH sidebar is hidden by the arrangement; this bar is the navigator over
 * the same Workspace and Session controllers. It reads the Host-backed lists and
 * delegates selection to `ctx.uiWorkspace`, so it does not keep a second session
 * store. The active row is the persisted `dsh.sessions.current` selection.
 *
 * @module prac-web-app/client/title-bar
 */

import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

/** The selection key DSH's Workspace navigation persists. */
const SELECTION_KEY = "dsh.sessions.current";

/** A bare observable, matching the DSH controller sources. */
interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

interface WorkspaceView {
  workspaceId: string;
  path: string;
  title: string;
  sessionIds: readonly string[];
}

interface WorkspaceSnapshot {
  items: readonly WorkspaceView[];
}

interface SessionSummary {
  /** DSH's row identity; `byId` is keyed by it, and the row itself is `id`. */
  id: string;
  workspaceId: string;
  title?: string;
  updatedAt?: number;
}

interface SessionListState {
  ids: readonly string[];
  byId: Readonly<Record<string, SessionSummary>>;
}

/** One layout command the title bar's Layout menu offers. */
export interface PracLayoutAction {
  /** Stable id for the menu row. */
  readonly id: string;
  /** What the row says. */
  readonly label: string;
  /** Run it; the menu closes after. */
  run(): void;
}

/** One Space: a named layout over the same project folder. */
export interface SpaceInfo {
  readonly id: string;
  readonly name: string;
}

/** The Space registry the bar's switcher drives. */
export interface PracSpacesFace {
  list(): readonly SpaceInfo[];
  active(): string;
  switchTo(id: string): void;
  create(name?: string): string;
  rename(id: string, name: string): void;
  remove(id: string): void;
  onDidChange(listener: () => void): () => void;
}

/** The DSH services the bar drives. */
export interface PracTitleFace {
  workspaces: { list: Observable<WorkspaceSnapshot> };
  sessions: { list: Observable<SessionListState> };
  /** The session adapter's current identity: the same source the IDE boot used. */
  uiSession: { adapter: { current: Observable<{ key?: string }> } };
  openSession(sessionId: string): void;
  openWorkspace(workspaceId: string): Promise<void>;
  openWorkspaceFolder(path: string): void;
  startSession(workspaceId?: string): void;
  /** The dock/layout commands (move a tool window, later presets and reset). */
  layoutActions(): readonly PracLayoutAction[];
  /** The Space registry: named layouts over the same project folder. */
  spaces: PracSpacesFace;
  /** Whether the bottom panel is collapsed. */
  bottomCollapsed(): boolean;
  /** Collapse / expand the bottom panel. */
  toggleBottom(): void;
}

interface PracTitleBarProps {
  face: PracTitleFace;
}

/** Read the persisted selection, tolerating an absent or malformed value. */
function readSelection(): string | undefined {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as { sessionId?: unknown };
    return typeof value.sessionId === "string" ? value.sessionId : undefined;
  } catch {
    return undefined;
  }
}

/** The workspace/session title bar and its two switchers. */
export function PracTitleBar({ face }: PracTitleBarProps): ReactElement {
  const workspaces = useSyncExternalStore(
    (listener) => face.workspaces.list.subscribe(listener),
    () => face.workspaces.list.getSnapshot(),
  );
  const sessions = useSyncExternalStore(
    (listener) => face.sessions.list.subscribe(listener),
    () => face.sessions.list.getSnapshot(),
  );
  const [selected, setSelected] = useState<string | undefined>(readSelection);
  const adapter = useSyncExternalStore(
    (listener) => face.uiSession.adapter.current.subscribe(listener),
    () => face.uiSession.adapter.current.getSnapshot(),
  );
  const current = adapter.key ?? selected;
  const [menu, setMenu] = useState<"workspace" | "session" | "layout" | "space" | null>(null);
  const [bottomOpen, setBottomOpen] = useState(() => !face.bottomCollapsed());
  const [spacesState, setSpacesState] = useState(() => ({
    list: face.spaces.list(),
    active: face.spaces.active(),
  }));
  useEffect(
    () =>
      face.spaces.onDidChange(() =>
        setSpacesState({ list: face.spaces.list(), active: face.spaces.active() }),
      ),
    [face.spaces],
  );

  useEffect(() => {
    const update = (): void => setSelected(readSelection());
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);

  useEffect(() => {
    if (menu === null) return;
    const close = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(".prac-titlebar") !== null) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const activeSession = current === undefined ? undefined : sessions.byId[current];
  // A Session row carries no workspaceId: Workspace membership is the only
  // relation, so the label follows the Workspace whose sessionIds contains it.
  const activeWorkspace =
    current === undefined
      ? workspaces.items[0]
      : (workspaces.items.find((workspace) => workspace.sessionIds.includes(current)) ??
        workspaces.items[0]);
  const sessionTitle = activeSession?.title ?? "New Session";
  const workspaceTitle = activeWorkspace?.title ?? "No workspace";
  const workspaceSessions = (workspace: WorkspaceView): readonly SessionSummary[] =>
    workspace.sessionIds
      .map((id) => sessions.byId[id])
      .filter((session): session is SessionSummary => session !== undefined);

  const chooseSession = (sessionId: string): void => {
    face.openSession(sessionId);
    setSelected(sessionId);
    setMenu(null);
  };
  const chooseWorkspace = (workspaceId: string): void => {
    // A Workspace pick means "show this Workspace's conversation": reuse its
    // first known Session. `openWorkspace` creates a blank and has been
    // rejecting in this profile; a listed Session is the direct, observable path.
    const workspace = workspaces.items.find((item) => item.workspaceId === workspaceId);
    const first = workspace?.sessionIds
      .map((id) => sessions.byId[id])
      .find((session): session is SessionSummary => session !== undefined);
    if (first !== undefined) {
      face.openSession(first.id);
      setSelected(first.id);
      setMenu(null);
      if (workspace !== undefined) face.openWorkspaceFolder(workspace.path);
      return;
    }
    void face
      .openWorkspace(workspaceId)
      .then(() => {
        setSelected(readSelection());
        setMenu(null);
      })
      .catch(() => setMenu(null));
  };
  const newSession = (): void => {
    face.startSession(activeWorkspace?.workspaceId);
    setMenu(null);
  };

  return createElement(
    "header",
    { className: "prac-titlebar", "data-prac-titlebar": "" },
    createElement("div", { className: "prac-title-brand", "aria-hidden": "true" }, "p"),
    createElement(
      "button",
      {
        type: "button",
        className: "prac-title-button",
        "aria-haspopup": "menu",
        "aria-expanded": menu === "workspace",
        onClick: () => setMenu(menu === "workspace" ? null : "workspace"),
      },
      createElement("span", { className: "dot" }),
      createElement("span", { className: "label" }, workspaceTitle),
      createElement("span", { className: "chev" }, "▾"),
    ),
    createElement("span", { className: "prac-title-sep" }, "/"),
    createElement(
      "button",
      {
        type: "button",
        className: "prac-title-button",
        "aria-haspopup": "menu",
        "aria-expanded": menu === "session",
        onClick: () => setMenu(menu === "session" ? null : "session"),
      },
      createElement("span", { className: "label" }, sessionTitle),
      createElement("span", { className: "chev" }, "▾"),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "prac-title-action",
        title: "Spaces",
        "aria-haspopup": "menu",
        "aria-expanded": menu === "space",
        "data-prac-space": spacesState.active,
        style: { whiteSpace: "nowrap" },
        onClick: () => setMenu(menu === "space" ? null : "space"),
      },
      spacesState.list.find((space) => space.id === spacesState.active)?.name ?? "Space 1",
    ),
    createElement("div", { className: "prac-title-spacer" }),
    createElement(
      "button",
      {
        type: "button",
        className: "prac-title-action",
        title: bottomOpen ? "Hide bottom panel" : "Show bottom panel",
        "data-prac-bottom-toggle": bottomOpen ? "open" : "closed",
        "aria-pressed": bottomOpen,
        "aria-label": bottomOpen ? "Hide bottom panel" : "Show bottom panel",
        onClick: () => {
          face.toggleBottom();
          setBottomOpen((open) => !open);
        },
      },
      "\u25a4",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "prac-title-action",
        title: "Layout",
        "aria-haspopup": "menu",
        "aria-expanded": menu === "layout",
        onClick: () => setMenu(menu === "layout" ? null : "layout"),
      },
      "\u25a6",
    ),
    createElement(
      "button",
      { type: "button", className: "prac-title-action", title: "New session", onClick: newSession },
      "+",
    ),
    menu === "workspace"
      ? createElement(
          "div",
          { className: "prac-title-menu", style: { left: "38px" } },
          createElement("div", { className: "prac-title-menu-label" }, "Workspaces"),
          ...workspaces.items.map((workspace) =>
            createElement(
              "button",
              {
                key: workspace.workspaceId,
                type: "button",
                className: "prac-title-item",
                onClick: () => chooseWorkspace(workspace.workspaceId),
              },
              createElement(
                "span",
                { className: "check" },
                workspace.workspaceId === activeWorkspace?.workspaceId ? "✓" : "",
              ),
              createElement(
                "span",
                { className: "main" },
                createElement("b", null, workspace.title),
                createElement("span", null, workspace.path),
              ),
            ),
          ),
        )
      : null,
    menu === "space"
      ? createElement(
          "div",
          { className: "prac-title-menu", style: { right: "0" } },
          createElement("div", { className: "prac-title-menu-label" }, "Spaces"),
          ...spacesState.list.map((space) =>
            createElement(
              "button",
              {
                key: space.id,
                type: "button",
                className: "prac-title-item",
                onClick: () => {
                  face.spaces.switchTo(space.id);
                  setMenu(null);
                },
              },
              createElement(
                "span",
                { className: "check" },
                space.id === spacesState.active ? "✓" : "",
              ),
              createElement("span", { className: "main" }, createElement("b", null, space.name)),
            ),
          ),
          createElement("div", { className: "prac-title-menu-sep" }),
          createElement(
            "button",
            {
              type: "button",
              className: "prac-title-item new",
              onClick: () => {
                face.spaces.create();
                setMenu(null);
              },
            },
            createElement("span", { className: "plus" }, "+"),
            createElement("span", null, "New Space"),
          ),
          createElement(
            "button",
            {
              type: "button",
              className: "prac-title-item",
              onClick: () => {
                const current = spacesState.list.find((space) => space.id === spacesState.active);
                const name = window.prompt("Rename Space", current?.name);
                if (name !== null && name.trim() !== "") {
                  face.spaces.rename(spacesState.active, name.trim());
                }
                setMenu(null);
              },
            },
            "重命名",
          ),
          createElement(
            "button",
            {
              type: "button",
              className: "prac-title-item",
              onClick: () => {
                face.spaces.remove(spacesState.active);
                setMenu(null);
              },
            },
            "删除",
          ),
        )
      : null,
    menu === "session"
      ? createElement(
          "div",
          { className: "prac-title-menu", style: { left: "210px" } },
          createElement(
            "div",
            { className: "prac-title-menu-label" },
            `Sessions in ${workspaceTitle}`,
          ),
          ...workspaceSessions(
            activeWorkspace ?? {
              workspaceId: "",
              path: "",
              title: "",
              sessionIds: [],
            },
          ).map((session) =>
            createElement(
              "button",
              {
                key: session.id,
                type: "button",
                className: "prac-title-item",
                onClick: () => chooseSession(session.id),
              },
              createElement(
                "span",
                { className: "check" },
                session.id === activeSession?.id ? "✓" : "",
              ),
              createElement(
                "span",
                { className: "main" },
                createElement("b", null, session.title ?? "Untitled session"),
                createElement(
                  "span",
                  null,
                  session.updatedAt === undefined
                    ? ""
                    : new Date(session.updatedAt).toLocaleString(),
                ),
              ),
            ),
          ),
          createElement("div", { className: "prac-title-menu-sep" }),
          createElement(
            "button",
            { type: "button", className: "prac-title-item new", onClick: newSession },
            createElement("span", { className: "plus" }, "+"),
            createElement("span", null, "New session"),
          ),
        )
      : null,
    menu === "layout"
      ? createElement(
          "div",
          {
            className: "prac-title-menu",
            style: { left: "auto", right: "8px", minWidth: "240px" },
          },
          createElement("div", { className: "prac-title-menu-label" }, "Layout"),
          ...face.layoutActions().map((action) =>
            createElement(
              "button",
              {
                key: action.id,
                type: "button",
                className: "prac-title-item",
                onClick: () => {
                  action.run();
                  setMenu(null);
                },
              },
              createElement("span", { className: "check" }, ""),
              createElement("span", { className: "main" }, createElement("b", null, action.label)),
            ),
          ),
        )
      : null,
  );
}

/** One item a dock rail shows: a container, a view, or the agent. */
export interface PracRailItem {
  /** Stable id; the face's `select` receives it back. */
  readonly id: string;
  /** The visible name (the glyph is derived from it). */
  readonly label: string;
  /** The item is the dock's active tool window. */
  readonly active: boolean;
  /** The item is on screen **outside** its dock (the agent maximized in the editor area). */
  readonly maximized?: boolean;
}

/** The face a dock rail drives. */
export interface PracRailFace {
  /** The items to show, in order. */
  items(): readonly PracRailItem[];
  /** Called when the items or their active state may have changed. */
  onDidChange(listener: () => void): () => void;
  /** Bring the item's tool window forward. */
  select(id: string): void;
}

/**
 * A dock's rail: one button per tool window, drawn at the dock's outer edge.
 *
 * The rail is **outside** the dock's content box (the frame reserves the column, the dock can
 * collapse to nothing), which is what lets it stay visible while its content is folded away. The
 * items are a face, not a catalogue: a dock's tool windows are whatever the arrangement put there.
 *
 * @param props - the face and the side the rail belongs to.
 */
export function PracRail({
  face,
  side,
}: {
  face: PracRailFace;
  side: "left" | "right";
}): ReactElement {
  const [items, setItems] = useState<readonly PracRailItem[]>(() => face.items());
  useEffect(() => {
    const update = (): void => setItems(face.items());
    update();
    return face.onDidChange(update);
  }, [face]);
  return createElement(
    "nav",
    {
      className: side === "left" ? "prac-activity" : "prac-activity prac-activity-right",
      "data-prac-activity": side,
      "aria-label": side === "left" ? "Containers" : "Agent and right dock",
    },
    ...items.map((item) =>
      createElement(
        "button",
        {
          key: item.id,
          type: "button",
          className: item.active ? "active" : "",
          title: item.label,
          "aria-label": item.label,
          "data-prac-rail-item": item.id,
          ...(item.maximized === true ? { "data-prac-rail-maximized": "true" } : {}),
          onClick: () => face.select(item.id),
        },
        createElement("span", { className: "glyph" }, item.label.slice(0, 1).toUpperCase()),
        createElement("span", { className: "label" }, item.label),
      ),
    ),
  );
}

/** shell chrome: title bar, vertical activity, hidden DSH chrome. */
export const PRAC_SHELL_CSS = `
/* macOS trackpad swipe-back/forward is decided on the **document root**'s
   overscroll: a wrapper with overflow:hidden is not a scroll container, so a
   rule there is ignored and Chrome still starts the history-navigation gesture.
   Keep the page's two-finger horizontal swipe from leaving prac. */
html,body{overscroll-behavior:none}
[data-prac-focus-strip]{display:none!important}
[data-prac-region="bottom"]{padding-left:48px!important;box-sizing:border-box!important}
[data-prac-container="left/dsh:sidebar"]{display:none!important}
[data-prac-region="left/dsh:sidebar"]{display:none!important}
[data-prac-frame]{padding-top:38px!important;padding-right:48px!important;box-sizing:border-box}
[data-prac-region="left"]{display:flex!important;flex-direction:row!important;align-items:stretch!important;min-width:0;padding-left:48px!important;box-sizing:border-box!important}
[data-prac-container-bar="left"],[data-prac-container-bar="center"]{display:none!important}
[data-prac-container-bar="left"] button{width:42px!important;min-height:36px!important;justify-content:center!important;text-align:center!important;font-size:10px!important;line-height:1.1!important;padding:2px!important}
[data-prac-region^="left/"]:not([data-prac-stack-row]){flex:1 1 auto!important;min-width:0!important}
.prac-activity{position:fixed;left:0;top:38px;bottom:0;width:48px;z-index:55;display:flex;flex-direction:column;align-items:center;gap:2px;padding:5px 0;background:var(--dsw-alias-bg-layer-2);border-right:1px solid var(--dsw-alias-border-l2);box-sizing:border-box}
.prac-activity-right{left:auto;right:0;border-right:0;border-left:1px solid var(--dsw-alias-border-l2)}
.prac-activity button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;width:42px;min-height:42px;padding:3px 1px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:9px;line-height:1.1;cursor:pointer}
.prac-activity button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.prac-activity button.active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.prac-activity button.active::before{content:"";position:absolute;left:-5px;top:9px;bottom:9px;width:3px;border-radius:3px;background:var(--dsw-alias-state-business-primary)}
.prac-activity-right button.active::before{left:auto;right:-5px}
.prac-activity button[data-prac-rail-maximized="true"]::after{content:"";position:absolute;right:5px;top:6px;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
.prac-activity .glyph{font-size:14px;font-weight:700;line-height:1}
.prac-activity .label{max-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prac-titlebar{position:fixed;inset:0 0 auto 0;height:38px;z-index:60;display:flex;align-items:center;gap:2px;box-sizing:border-box;padding:0 8px 0 10px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-text-default,inherit);font-size:12px}
.prac-title-brand{display:grid;place-items:center;width:21px;height:21px;margin-right:4px;border-radius:6px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-weight:700;font-size:11px}
.prac-title-button{display:inline-flex;align-items:center;gap:6px;height:26px;max-width:240px;min-width:0;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.prac-title-button:hover,.prac-title-button[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.prac-title-button .dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary);flex:none}
.prac-title-button .label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.prac-title-button .chev{color:var(--dsw-alias-label-tertiary);font-size:10px}
.prac-title-sep{color:var(--dsw-alias-label-tertiary)}
.prac-title-spacer{flex:1 1 auto}
.prac-title-action{width:27px;height:27px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:17px;line-height:1;cursor:pointer}
.prac-title-action:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.prac-title-menu{position:fixed;top:33px;z-index:70;min-width:280px;max-height:min(520px,70vh);overflow:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgba(0,0,0,.22)}
.prac-title-menu-group{padding:7px 8px 2px;color:var(--dsw-alias-label-tertiary);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.prac-title-menu-label{padding:5px 8px 3px;color:var(--dsw-alias-label-tertiary);font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
.prac-title-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.prac-title-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.prac-title-item .check{width:14px;text-align:center;color:var(--dsw-alias-state-business-primary);flex:none}
.prac-title-item .main{flex:1 1 auto;min-width:0}
.prac-title-item .main b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.prac-title-item .main span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px}
.prac-title-item.new{color:var(--dsw-alias-state-business-primary);font-weight:600}
.prac-title-item .plus{width:14px;text-align:center;font-size:15px}
.prac-title-menu-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l2)}
@media (max-width:940px){
  .prac-activity{width:44px}
  .prac-activity-right{width:44px}
  [data-prac-frame]{padding-right:44px!important}
  [data-prac-region="left"]{padding-left:44px!important}
  .prac-title-button{max-width:150px}
  .prac-title-menu{left:8px!important;right:8px;min-width:0}
  /* Secondary becomes a drawer instead of a third column: at 768 the
     three-column split left the chat ~240px and clipped its content. */
  [data-prac-region="right"]{position:fixed!important;right:44px;top:38px;bottom:0;width:min(400px,88vw);z-index:45;border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-12px 0 32px rgba(0,0,0,.16);background:var(--dsw-alias-bg-layer-1)}
}
`;
