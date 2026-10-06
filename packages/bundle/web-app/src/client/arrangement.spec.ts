import { describe, expect, it } from "vite-plus/test";
import type {
  LayoutState,
  PracLayoutFace,
  RoleBindings,
  ViewRecord,
} from "prac-client-ui-layout/client";
import type { VscodeCatalogueEntry } from "prac-client-vscode-host/client";
import {
  BOTTOM,
  CONVERSATION,
  DEFAULT_PLACEMENTS,
  DSH_CONVERSATION_VIEW,
  DSH_SIDEBAR_VIEW,
  LEFT,
  RIGHT,
  STAGE,
  VSCODE_SURFACE,
  arrange,
  focusView,
  openFileInto,
  placeCatalogue,
  placeSurfaces,
  restoreCentre,
  staleFileViews,
} from "./arrangement.js";

/**
 * The arrangement's placement policy, tested as calls rather than pixels.
 *
 * These are the rules the live gates were checking through a browser — "the
 * focused surface takes the centre and the other parks in the track", "defaults
 * fill gaps instead of re-asserting themselves". Both are decidable from the
 * calls the policy makes, so they belong here; what stays live is that the frame
 * renders the placement the policy asked for.
 */
interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A file view, as the host names them (`vscode:file:<resource>`). */
const FILE_VIEW = "vscode:file:vscode-remote://127.0.0.1:3084/workspace/file.ts";

/** The state the policy reads; `arrange` only ever looks at `views`. */
const stateWith = (views: LayoutState["views"] = {}): LayoutState => ({
  viewportWidth: 1600,
  viewportHeight: 1000,
  tree: { type: "split", id: "root", dir: "row", children: [] },
  views,
  catalogueVersion: 0,
  activePanelId: null,
});

/**
 * A recording stand-in for the mechanism's face.
 *
 * The real face cannot be imported here — `prac-client-ui-layout/client` publishes
 * types only — and it should not be: the policy's contract is *which calls it
 * makes*, so a stub that records them is the honest test double, and every
 * member is written out so a face that grows a method fails to compile here.
 *
 * @param views - the view table the policy will read.
 */
function recordingFace(views: LayoutState["views"] = {}): {
  face: PracLayoutFace;
  calls: Call[];
} {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    (...args: readonly unknown[]): void => {
      calls.push({ method, args });
    };
  const face = {
    getState: () => stateWith(views),
    subscribe: () => () => {},
    listViews: () => [],
    listRegions: () => [],
    place: record("place"),
    show: record("show"),
    hide: record("hide"),
    setViewCollapsed: record("setViewCollapsed"),
    setCollapsed: record("setCollapsed"),
    setWidth: record("setWidth"),
    splitView: record("splitView"),
    bindRoles: record("bindRoles"),
    bindTrack: record("bindTrack"),
    setViewFlags: record("setViewFlags"),
    activeView: () => null,
  } satisfies PracLayoutFace;
  return { face, calls };
}

/** The `[method, ...args]` shapes a recording produced. */
const shapes = (calls: readonly Call[]) => calls.map((call) => [call.method, ...call.args]);

describe("placeSurfaces", () => {
  it("centres the conversation and parks the current file when the conversation has attention", () => {
    const { face, calls } = recordingFace();
    placeSurfaces(face, CONVERSATION, FILE_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, STAGE],
      ["place", FILE_VIEW, RIGHT],
    ]);
  });

  it("centres the current file and parks the conversation when the editor has attention", () => {
    const { face, calls } = recordingFace();
    placeSurfaces(face, VSCODE_SURFACE, FILE_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, RIGHT],
      ["place", FILE_VIEW, STAGE],
    ]);
  });

  it("places nothing else when no file is open", () => {
    const { face, calls } = recordingFace();
    placeSurfaces(face, VSCODE_SURFACE, null);
    expect(shapes(calls)).toEqual([["place", DSH_CONVERSATION_VIEW, RIGHT]]);
  });
});

describe("focusView", () => {
  it("parks the conversation in the track when something else comes forward", () => {
    const { face, calls } = recordingFace();
    focusView(face, FILE_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, RIGHT],
      ["place", FILE_VIEW, STAGE],
    ]);
  });

  it("does not park the conversation when the conversation *is* what comes forward", () => {
    const { face, calls } = recordingFace();
    focusView(face, DSH_CONVERSATION_VIEW);
    expect(shapes(calls)).toEqual([["place", DSH_CONVERSATION_VIEW, STAGE]]);
  });
});

describe("staleFileViews", () => {
  const records = {
    [FILE_VIEW]: { region: STAGE, order: 0, hidden: false },
    "vscode:file:vscode-remote://127.0.0.1:3084/workspace/closed.ts": {
      region: STAGE,
      order: 1,
      hidden: false,
    },
    [DSH_CONVERSATION_VIEW]: { region: STAGE, order: 2, hidden: false },
    "vscode:view:workbench.view.search": { region: LEFT, order: 3, hidden: false },
  } satisfies Record<string, ViewRecord>;
  const resourceOf = (view: string): string | undefined =>
    view.startsWith("vscode:file:") ? view.slice("vscode:file:".length) : undefined;

  it("names the file views the app no longer has open", () => {
    expect(staleFileViews(records, new Set([FILE_VIEW]), resourceOf)).toEqual([
      "vscode:file:vscode-remote://127.0.0.1:3084/workspace/closed.ts",
    ]);
  });

  it("names every file view when nothing is open (a reload)", () => {
    expect(staleFileViews(records, new Set(), resourceOf).sort()).toEqual(
      [FILE_VIEW, "vscode:file:vscode-remote://127.0.0.1:3084/workspace/closed.ts"].sort(),
    );
  });

  it("never touches a view that is not a file view", () => {
    // The host's answer decides, not a name this module could invent: a view whose
    // id merely looks like a file is left alone.
    const ids = staleFileViews(records, new Set(), () => undefined);
    expect(ids).toEqual([]);
  });
});

describe("restoreCentre", () => {
  it("moves the conversation back when the centre holds something else", () => {
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: RIGHT, order: 0, hidden: false },
    });
    expect(restoreCentre(face)).toBe(true);
    expect(shapes(calls)).toEqual([["place", DSH_CONVERSATION_VIEW, STAGE]]);
  });

  it("leaves it where it is when the centre is already its", () => {
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: STAGE, order: 0, hidden: false },
    });
    expect(restoreCentre(face)).toBe(false);
    expect(shapes(calls)).toEqual([]);
  });
});

describe("openFileInto", () => {
  it("gives a newly opened file the centre and keeps the conversation on screen", () => {
    const { face, calls } = recordingFace();
    openFileInto(face, FILE_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, RIGHT],
      ["place", FILE_VIEW, STAGE],
    ]);
  });
});

describe("arrange", () => {
  it("binds the roles and the parking track the borrowed vocabulary resolves through", () => {
    const { face, calls } = recordingFace();
    arrange(face);
    expect(calls[0]).toEqual({
      method: "bindRoles",
      args: [
        {
          primarySidebar: DSH_SIDEBAR_VIEW,
          secondarySidebar: "dsh:rightbar",
        } satisfies RoleBindings,
      ],
    });
    expect(calls[1]).toEqual({ method: "bindTrack", args: [RIGHT] });
  });

  it("places every default, and hides the ones that are placed out of the way", () => {
    const { face, calls } = recordingFace();
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([
      ["place", DSH_SIDEBAR_VIEW, LEFT],
      ["place", DSH_CONVERSATION_VIEW, STAGE],
      ["place", "dsh:rightbar", RIGHT],
      ["hide", "dsh:rightbar"],
    ]);
  });

  it("fills gaps only: a view the restored state already knows keeps its placement", () => {
    // A previous session moved the conversation into the bottom bar and the DSH
    // sidebar to the right. Re-asserting the defaults would undo both.
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: "bottom", order: -2, hidden: false },
      [DSH_SIDEBAR_VIEW]: { region: RIGHT, order: -1, hidden: false },
    });
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([
      ["place", "dsh:rightbar", RIGHT],
      ["hide", "dsh:rightbar"],
    ]);
  });

  it("still places a view the state has never seen", () => {
    const known = DEFAULT_PLACEMENTS.map((entry) => entry.view).filter(
      (view) => view !== DSH_SIDEBAR_VIEW,
    );
    const { face, calls } = recordingFace(
      Object.fromEntries(known.map((view) => [view, { region: LEFT, order: 0, hidden: false }])),
    );
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([["place", DSH_SIDEBAR_VIEW, LEFT]]);
  });
});

describe("placeCatalogue", () => {
  /** A catalogue entry, defaulted to one sidebar view. */
  const entry = (over: Partial<VscodeCatalogueEntry>): VscodeCatalogueEntry => ({
    view: "vscode:view:workbench.view.search",
    appId: "workbench.view.search",
    title: "Search",
    source: "view",
    location: "sidebar",
    ...over,
  });

  it("places a view the app reports into the region its location names", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [entry({})]);
    expect(shapes(calls)).toEqual([["place", "vscode:view:workbench.view.search", LEFT]]);
  });

  it("maps each app location to its region", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({ view: "vscode:view:a", appId: "a", location: "sidebar" }),
      entry({ view: "vscode:view:b", appId: "b", location: "panel" }),
      entry({ view: "vscode:view:c", appId: "c", location: "auxiliarybar" }),
    ]);
    expect(shapes(calls)).toEqual([
      ["place", "vscode:view:a", LEFT],
      ["place", "vscode:view:b", BOTTOM],
      ["place", "vscode:view:c", RIGHT],
    ]);
  });

  it("leaves the catalogue's other source alone: files are placed by opening, not by location", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({ view: "vscode:file:x", appId: "x", source: "file", location: "stage" }),
    ]);
    expect(shapes(calls)).toEqual([]);
  });

  it("leaves the arrangement's exclusions off screen", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({
        view: "vscode:view:workbench.panel.chat.view.copilot",
        appId: "workbench.panel.chat.view.copilot",
        location: "auxiliarybar",
      }),
      entry({ view: "vscode:view:workbench.debug.welcome", appId: "workbench.debug.welcome" }),
    ]);
    expect(shapes(calls)).toEqual([]);
  });

  it("fills gaps only: a view that already has a record keeps its placement", () => {
    const { face, calls } = recordingFace({
      "vscode:view:workbench.view.search": { region: RIGHT, order: 0, hidden: false },
    });
    placeCatalogue(face, [entry({})]);
    expect(shapes(calls)).toEqual([]);
  });
});
