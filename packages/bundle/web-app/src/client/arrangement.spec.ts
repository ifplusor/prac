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

/** A file view, as the host names them (`vscode:file:<placement>:<resource>`). */
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
  children: Map<string, { id: string; label?: string }[]>;
} {
  const calls: Call[] = [];
  const children = new Map<string, { id: string; label?: string }[]>();
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
    placeQuietly: record("placeQuietly"),
    removeView: record("removeView"),
    setRegionChildren: (
      regionId: string,
      list: readonly { id: string; label?: string }[],
    ): void => {
      calls.push({ method: "setRegionChildren", args: [regionId, list] });
      children.set(regionId, [...list]);
    },
    regionChildren: (regionId: string) => children.get(regionId) ?? [],
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
    onDidRequestCloseView: () => () => {},
    // The frame owns the region tree: `addGroup` asks it for a region and binds the group to
    // the id it returns. A test double that never splits answers `undefined`.
    createRegionBeside: () => undefined,
    regionInDirection: () => undefined,
    setFront: () => {},
  } satisfies PracLayoutFace;
  return { face, calls, children };
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
  /** A catalogue entry, defaulted to one view of the Explorer container. */
  const entry = (over: Partial<VscodeCatalogueEntry>): VscodeCatalogueEntry => ({
    view: "vscode:view:workbench.explorer.fileView",
    appId: "workbench.explorer.fileView",
    title: "Folders",
    source: "view",
    location: "sidebar",
    containerId: "workbench.view.explorer",
    containerTitle: "Explorer",
    ...over,
  });

  it("gives the region one named child per container", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({}),
      entry({ view: "vscode:view:outline", appId: "outline", title: "Outline" }),
      entry({
        view: "vscode:view:workbench.view.search",
        appId: "workbench.view.search",
        title: "Search",
        containerId: "workbench.view.search",
        containerTitle: "Search",
      }),
    ]);
    expect(shapes(calls)[0]).toEqual([
      "setRegionChildren",
      LEFT,
      [
        { id: "left/container:workbench.view.explorer", label: "Explorer" },
        { id: "left/container:workbench.view.search", label: "Search" },
      ],
    ]);
    expect(shapes(calls).slice(1)).toEqual([
      [
        "placeQuietly",
        "vscode:view:workbench.explorer.fileView",
        "left/container:workbench.view.explorer",
      ],
      ["placeQuietly", "vscode:view:outline", "left/container:workbench.view.explorer"],
      ["placeQuietly", "vscode:view:workbench.view.search", "left/container:workbench.view.search"],
    ]);
  });

  it("maps each app location to its region", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({ view: "vscode:view:a", appId: "a", location: "sidebar", containerId: "c.a" }),
      entry({ view: "vscode:view:b", appId: "b", location: "panel", containerId: "c.b" }),
      entry({ view: "vscode:view:c", appId: "c", location: "auxiliarybar", containerId: "c.c" }),
    ]);
    expect(shapes(calls).filter(([method]) => method === "setRegionChildren")).toEqual([
      ["setRegionChildren", LEFT, [{ id: "left/container:c.a", label: "Explorer" }]],
      ["setRegionChildren", BOTTOM, [{ id: "bottom/container:c.b", label: "Explorer" }]],
      ["setRegionChildren", RIGHT, [{ id: "right/container:c.c", label: "Explorer" }]],
    ]);
  });

  it("gives a view with no container a child of its own", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({
        view: "vscode:view:loose",
        appId: "loose",
        title: "Loose",
        containerId: undefined,
        containerTitle: undefined,
      }),
    ]);
    expect(shapes(calls)).toEqual([
      ["setRegionChildren", LEFT, [{ id: "left/vscode:view:loose", label: "Loose" }]],
      ["placeQuietly", "vscode:view:loose", "left/vscode:view:loose"],
    ]);
  });

  it("places a file placement in the region the app says it is shown in", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: "right",
      }),
    ]);
    expect(shapes(calls)).toEqual([["placeQuietly", "vscode:file:p1:x", "right"]]);
  });

  it("gives a file placement the app has not shown yet the centre", () => {
    const { face, calls } = recordingFace();
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: null,
      }),
    ]);
    expect(shapes(calls)).toEqual([["placeQuietly", "vscode:file:p1:x", STAGE]]);
  });

  it("splits a file's second placement out beside the one already on screen", () => {
    // The app copied the editor into another group (Split Editor): the file already has
    // a view, and the new placement goes **beside** it rather than on top of it.
    const { face, calls } = recordingFace({
      "vscode:file:p1:x": { region: STAGE, order: 0, hidden: false },
    });
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: STAGE,
      }),
      entry({
        view: "vscode:file:p2:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: null,
      }),
    ]);
    expect(shapes(calls)).toEqual([
      ["placeQuietly", "vscode:file:p2:x", STAGE],
      ["splitView", "vscode:file:p2:x", "right"],
    ]);
  });

  it("leaves a file placement the frame already knows where it is", () => {
    // The person may have moved it, and the catalogue is not more authoritative about
    // placement than they are.
    const { face, calls } = recordingFace({
      "vscode:file:p1:x": { region: "right", order: 0, hidden: false },
    });
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: STAGE,
      }),
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

  it("keeps a child this function does not own, ahead of the containers", () => {
    const { face, calls } = recordingFace();
    face.setRegionChildren(LEFT, [{ id: "left/dsh:sidebar", label: "sidebar" }]);
    calls.length = 0;
    placeCatalogue(face, [entry({})]);
    expect(shapes(calls)[0]).toEqual([
      "setRegionChildren",
      LEFT,
      [
        { id: "left/dsh:sidebar", label: "sidebar" },
        { id: "left/container:workbench.view.explorer", label: "Explorer" },
      ],
    ]);
  });
});
