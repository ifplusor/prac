import { describe, expect, it } from "vite-plus/test";
import type { LayoutState, PracLayoutFace, RoleBindings } from "prac-client-ui-layout/client";
import {
  CONVERSATION,
  DEFAULT_PLACEMENTS,
  DSH_CONVERSATION_VIEW,
  DSH_SIDEBAR_VIEW,
  LEFT,
  RIGHT,
  STAGE,
  VSCODE_EDITOR_VIEW,
  VSCODE_SIDEBAR_VIEW,
  VSCODE_SURFACE,
  arrange,
  focusView,
  placeSurfaces,
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
  } satisfies PracLayoutFace;
  return { face, calls };
}

/** The `[method, ...args]` shapes a recording produced. */
const shapes = (calls: readonly Call[]) => calls.map((call) => [call.method, ...call.args]);

describe("placeSurfaces", () => {
  it("centres the conversation and parks the editor when the conversation has attention", () => {
    const { face, calls } = recordingFace();
    placeSurfaces(face, CONVERSATION);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, STAGE],
      ["place", VSCODE_EDITOR_VIEW, RIGHT],
    ]);
  });

  it("centres the editor and parks the conversation when the editor has attention", () => {
    const { face, calls } = recordingFace();
    placeSurfaces(face, VSCODE_SURFACE);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, RIGHT],
      ["place", VSCODE_EDITOR_VIEW, STAGE],
    ]);
  });
});

describe("focusView", () => {
  it("parks the conversation in the track when something else comes forward", () => {
    const { face, calls } = recordingFace();
    focusView(face, VSCODE_EDITOR_VIEW);
    expect(shapes(calls)).toEqual([
      ["place", DSH_CONVERSATION_VIEW, RIGHT],
      ["place", VSCODE_EDITOR_VIEW, STAGE],
    ]);
  });

  it("does not park the conversation when the conversation *is* what comes forward", () => {
    const { face, calls } = recordingFace();
    focusView(face, DSH_CONVERSATION_VIEW);
    expect(shapes(calls)).toEqual([["place", DSH_CONVERSATION_VIEW, STAGE]]);
  });
});

describe("arrange", () => {
  it("binds the roles and the parking track the borrowed vocabulary resolves through", () => {
    const { face, calls } = recordingFace();
    arrange(face);
    expect(calls[0]).toEqual({
      method: "bindRoles",
      args: [{ sidebar: DSH_SIDEBAR_VIEW, rightbar: "dsh:rightbar" } satisfies RoleBindings],
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
      ["place", VSCODE_EDITOR_VIEW, RIGHT],
      ["place", VSCODE_SIDEBAR_VIEW, LEFT],
      ["hide", VSCODE_SIDEBAR_VIEW],
    ]);
  });

  it("fills gaps only: a view the restored state already knows keeps its placement", () => {
    // A previous session moved the conversation into the bottom bar and showed
    // the VS Code sidebar. Re-asserting the defaults would undo both.
    const { face, calls } = recordingFace({
      [DSH_CONVERSATION_VIEW]: { region: "bottom", order: -2, hidden: false },
      [VSCODE_SIDEBAR_VIEW]: { region: RIGHT, order: -1, hidden: false },
    });
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([
      ["place", DSH_SIDEBAR_VIEW, LEFT],
      ["place", "dsh:rightbar", RIGHT],
      ["hide", "dsh:rightbar"],
      ["place", VSCODE_EDITOR_VIEW, RIGHT],
    ]);
  });

  it("still places a view the state has never seen", () => {
    const known = DEFAULT_PLACEMENTS.map((entry) => entry.view).filter(
      (view) => view !== VSCODE_EDITOR_VIEW,
    );
    const { face, calls } = recordingFace(
      Object.fromEntries(known.map((view) => [view, { region: LEFT, order: 0, hidden: false }])),
    );
    arrange(face);
    expect(shapes(calls.slice(2))).toEqual([["place", VSCODE_EDITOR_VIEW, RIGHT]]);
  });
});
