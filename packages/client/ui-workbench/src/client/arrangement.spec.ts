import { describe, expect, it } from "vite-plus/test";
import type { LayoutState, ItemRecord } from "prac-ui-kit-frame";
import type { ItemInfo } from "prac-client-ui-frame/client";
import type { PracLayoutFace, RoleBindings } from "prac-client-ui-frame/client";
import type { VscodeCatalogueEntry } from "prac-client-vscode-host/client";
import {
  BOTTOM,
  DEFAULT_PLACEMENTS,
  DSH_CONVERSATION_VIEW,
  DSH_SIDEBAR_VIEW,
  LEFT,
  RIGHT,
  CENTER,
  arrange,
  openFileInto,
  placeCatalogue,
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

/** The state the policy reads; `arrange` only ever looks at `items`. */
const stateWith = (items: LayoutState["items"] = {}): LayoutState => ({
  viewportWidth: 1600,
  viewportHeight: 1000,
  tree: { type: "split", id: "root", dir: "row", children: [] },
  items,
  catalogueVersion: 0,
  activePanelId: null,
});

/**
 * A recording stand-in for the mechanism's face.
 *
 * The real face cannot be imported here — `prac-ui-kit-frame` publishes
 * types only — and it should not be: the policy's contract is *which calls it
 * makes*, so a stub that records them is the honest test double, and every
 * member is written out so a face that grows a method fails to compile here.
 *
 * @param items - the view table the policy will read.
 */
function recordingFace(items: LayoutState["items"] = {}): {
  face: PracLayoutFace;
  calls: Call[];
  children: Map<string, { id: string; label?: string }[]>;
} {
  const calls: Call[] = [];
  const children = new Map<string, { id: string; label?: string }[]>();
  // The face is a **mutable** table, like the real one: a policy that places and then reads back
  // (the off-screen sweep does exactly that) must see what it just wrote.
  const live: LayoutState["items"] = { ...items };
  const record =
    (method: string) =>
    (...args: readonly unknown[]): void => {
      calls.push({ method, args });
    };
  const place =
    (method: string) =>
    (id: string, region: string): void => {
      calls.push({ method, args: [id, region] });
      live[id] = { ...(live[id] ?? { order: 0, hidden: false, kind: "window" }), region };
    };
  const face = {
    getState: () => stateWith(live),
    subscribe: () => () => {},
    listViews: (): ItemInfo[] =>
      Object.entries(live).map(([id, record]) => ({
        id,
        region: record.region ?? null,
        hidden: record.hidden === true,
        order: record.order ?? null,
        kind: record.kind ?? "window",
      })),
    listRegions: () => [],
    removeRegion: () => undefined,
    place: place("place"),
    placeQuietly: place("placeQuietly"),
    removeItem: (id: string): void => {
      calls.push({ method: "removeItem", args: [id] });
      delete live[id];
    },
    setRegionChildren: (
      regionId: string,
      list: readonly { id: string; label?: string }[],
    ): void => {
      calls.push({ method: "setRegionChildren", args: [regionId, list] });
      children.set(regionId, [...list]);
    },
    regionChildren: (regionId: string) => children.get(regionId) ?? [],
    setRegionSelector: (regionId: string, selector: "rail" | "title" | "none"): void => {
      calls.push({ method: "setRegionSelector", args: [regionId, selector] });
    },
    selectContainer: (regionId: string, childId: string): void => {
      calls.push({ method: "selectContainer", args: [regionId, childId] });
    },
    activeContainer: () => null,
    show: record("show"),
    hide: (id: string): void => {
      calls.push({ method: "hide", args: [id] });
      if (live[id] !== undefined) live[id] = { ...live[id], hidden: true, kind: "window" };
    },
    setItemCollapsed: record("setItemCollapsed"),
    setItemSize: record("setItemSize"),
    setViewKind: record("setViewKind"),
    registerContentHost: () => () => {},
    registerBoardLayout: () => () => {},
    setViewBoard: () => {},
    setCollapsed: record("setCollapsed"),
    setWidth: record("setWidth"),
    splitView: record("splitView"),
    bindRoles: record("bindRoles"),
    bindTrack: record("bindTrack"),
    setItemFlags: record("setItemFlags"),
    activeView: () => null,
    onDidRequestCloseView: () => () => {},
    // The frame owns the region tree: `addGroup` asks it for a region and binds the group to
    // the id it returns. A test double that never splits answers `undefined`.
    createRegionBeside: () => undefined,
    regionInDirection: () => undefined,
    setFront: () => {},
    mergeGridCells: () => {},
    unmergeGridCell: () => {},
    moveGridCell: () => {},
    resizeGridCell: () => {},
    resizeGridTrack: () => {},
    setGridTrackWeight: () => {},
    registerWindowGroup: (() => {
      throw new Error("not used by this test double");
    }) as PracLayoutFace["registerWindowGroup"],
    unregisterWindowGroup: () => {},
    registerSurface: () => ({}) as never,
  } satisfies PracLayoutFace;
  return { face, calls, children };
}

/** The `[method, ...args]` shapes a recording produced. */
const shapes = (calls: readonly Call[]) => calls.map((call) => [call.method, ...call.args]);

describe("staleFileViews", () => {
  const records = {
    [FILE_VIEW]: { region: CENTER, order: 0, hidden: false, kind: "window" },
    "vscode:file:vscode-remote://127.0.0.1:3084/workspace/closed.ts": {
      region: CENTER,
      order: 1,
      hidden: false,
      kind: "window",
    },
    [DSH_CONVERSATION_VIEW]: { region: CENTER, order: 2, hidden: false, kind: "window" },
    "vscode:view:workbench.view.search": { region: LEFT, order: 3, hidden: false, kind: "window" },
  } satisfies Record<string, ItemRecord>;
  const resourceOf = (view: string): string | undefined =>
    view.startsWith("vscode:file:") ? view.slice("vscode:file:".length) : undefined;

  it("names the file items the app no longer has open", () => {
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
      [DSH_CONVERSATION_VIEW]: { region: RIGHT, order: 0, hidden: false, kind: "window" },
    });
    expect(restoreCentre(face)).toBe(true);
    expect(shapes(calls)).toEqual([["place", DSH_CONVERSATION_VIEW, CENTER]]);
  });

  it("leaves it where it is when the centre is already its", () => {
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: CENTER, order: 0, hidden: false, kind: "window" },
    });
    expect(restoreCentre(face)).toBe(false);
    expect(shapes(calls)).toEqual([]);
  });
});

describe("openFileInto", () => {
  it("puts a newly opened file in the centre window group and selects it", () => {
    const { face, calls } = recordingFace();
    openFileInto(face, FILE_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", FILE_VIEW, CENTER],
      ["show", FILE_VIEW],
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
      ["setRegionSelector", LEFT, "rail"],
      ["setRegionSelector", RIGHT, "rail"],
      ["setRegionSelector", BOTTOM, "title"],
      ["place", DSH_SIDEBAR_VIEW, LEFT],
      ["place", DSH_CONVERSATION_VIEW, CENTER],
      ["place", "dsh:rightbar", RIGHT],
      ["hide", "dsh:rightbar"],
      // The title bar owns session navigation: the sidebar stays registered but off screen.
      ["hide", DSH_SIDEBAR_VIEW],
    ]);
  });

  it("fills gaps only: a view the restored state already knows keeps its placement", () => {
    // A previous session moved the conversation into the bottom bar and the DSH
    // sidebar to the right. Re-asserting the defaults would undo both.
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: "bottom", order: -2, hidden: false, kind: "window" },
      [DSH_SIDEBAR_VIEW]: { region: RIGHT, order: -1, hidden: false, kind: "window" },
    });
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([
      ["setRegionSelector", LEFT, "rail"],
      ["setRegionSelector", RIGHT, "rail"],
      ["setRegionSelector", BOTTOM, "title"],
      ["place", "dsh:rightbar", RIGHT],
      ["hide", "dsh:rightbar"],
      ["hide", DSH_SIDEBAR_VIEW],
    ]);
  });

  it("still places a view the state has never seen", () => {
    const known = DEFAULT_PLACEMENTS.map((entry) => entry.view).filter(
      (view) => view !== DSH_SIDEBAR_VIEW,
    );
    const { face, calls } = recordingFace(
      Object.fromEntries(
        known.map((view) => [view, { region: LEFT, order: 0, hidden: false, kind: "window" }]),
      ),
    );
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([
      ["setRegionSelector", LEFT, "rail"],
      ["setRegionSelector", RIGHT, "rail"],
      ["setRegionSelector", BOTTOM, "title"],
      ["place", DSH_SIDEBAR_VIEW, LEFT],
      ["hide", DSH_SIDEBAR_VIEW],
    ]);
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
      // Outline starts folded, the way VS Code's Explorer shows it — the declaration is applied where
      // the view lands (`VIEW_DEFAULTS`).
      ["setItemCollapsed", "vscode:view:outline", true],
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
    expect(shapes(calls)).toEqual([["placeQuietly", "vscode:file:p1:x", CENTER]]);
  });

  it("splits a file's second placement out beside the one already on screen", () => {
    // The app copied the editor into another group (Split Editor): the file already has
    // a view, and the new placement goes **beside** it rather than on top of it.
    const { face, calls } = recordingFace({
      "vscode:file:p1:x": { region: CENTER, order: 0, hidden: false, kind: "window" },
    });
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: CENTER,
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
      ["placeQuietly", "vscode:file:p2:x", CENTER],
      ["splitView", "vscode:file:p2:x", "right"],
    ]);
  });

  it("leaves a file placement the frame already knows where it is", () => {
    // The person may have moved it, and the catalogue is not more authoritative about
    // placement than they are.
    const { face, calls } = recordingFace({
      "vscode:file:p1:x": { region: "right", order: 0, hidden: false, kind: "window" },
    });
    placeCatalogue(face, [
      entry({
        view: "vscode:file:p1:x",
        appId: "x",
        source: "file",
        location: "stage",
        region: CENTER,
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
    face.setRegionChildren(LEFT, [{ id: "left/notes", label: "Notes" }]);
    calls.length = 0;
    placeCatalogue(face, [entry({})]);
    expect(shapes(calls)[0]).toEqual([
      "setRegionChildren",
      LEFT,
      [
        { id: "left/notes", label: "Notes" },
        { id: "left/container:workbench.view.explorer", label: "Explorer" },
      ],
    ]);
  });

  it("places the app's panel items in the bottom track", () => {
    // `panel` maps to `bottom`, which is a visible track again: placing the view there is enough.
    const { face, calls } = recordingFace();
    placeCatalogue(face, [entry({ location: "panel", containerId: "c.panel" })]);
    expect(shapes(calls)).toEqual([
      ["setRegionChildren", BOTTOM, [{ id: "bottom/container:c.panel", label: "Explorer" }]],
      ["placeQuietly", "vscode:view:workbench.explorer.fileView", "bottom/container:c.panel"],
    ]);
  });
});
