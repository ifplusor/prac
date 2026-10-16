/**
 * Verification of the **container layer** — the borrowed VS Code viewlet, kept
 * as a *named child region* — and of the catalogue that fills it.
 *
 * Unit tests can prove `placeCatalogue` builds the right children out of a
 * catalogue object. What no unit test can prove is the claim the layer actually
 * makes on screen:
 *
 *  1. **the containers exist and are reachable** — each track renders a bar whose
 *     entries are prac's own sidebar plus the borrowed containers, because prac
 *     inherits no activity bar and the bar is the only way to switch;
 *  2. **one container at a time** — clicking a bar entry renders *that* child
 *     region and no sibling, for every entry, in both tracks. This is the whole
 *     point of borrowing the container ("每个位置同一时刻只显示一个"), and it is
 *     a fact about the renderer: the model can hold four children while the DOM
 *     holds one;
 *  3. **every placed view gets a host that paints** — the catalogue delivers the
 *     borrowed IDE surfaces; a view that is placed but renders nowhere (stranded
 *     in an unselected child, or in a box of zero height) is the failure this
 *     gate is for. The excluded upstream views stay *registered and unplaced*:
 *     the deferral is a placement decision, not a hole in the catalogue.
 *
 * The terminal is visited but not paint-checked: in this rig it has no PTY, so a
 * blank terminal would fail a pixel assertion for a reason that is not prac's.
 * Its view must still have a host with height, which is what (3) asserts.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:containers
 */
import { distinctColours, openPrac, report, requireUrl } from "./harness.mjs";

/** The track prac's own sidebar and the borrowed sidebar containers live in. */
const LEFT = "left";
/** The track the borrowed panel containers live in. */
const BOTTOM = "bottom";
/** prac's own sidebar: a child of `left`, so the bar switches to it too. */
const SIDEBAR = "left/dsh:sidebar";
/** The borrowed sidebar container with the most views (five in this build). */
const EXPLORER = "left/container:workbench.view.explorer";
/** A borrowed panel container whose view paints text without a PTY. */
const PROBLEMS = "bottom/container:workbench.panel.markers";
/** The borrowed terminal container: the bar must reach it, its view must mount. */
const TERMINAL = "bottom/container:terminal";
/** Views the arrangement defers (`arrangement.ts`): registered, never placed. */
const DEFERRED = [
  "vscode:view:workbench.debug.welcome",
  "vscode:view:workbench.panel.chat.view.copilot",
];
/** The borrowed views whose arrival is the catalogue's reason to exist. */
const SURFACES = [
  "vscode:view:workbench.explorer.fileView",
  "vscode:view:workbench.view.search",
  "vscode:view:workbench.scm",
  "vscode:view:workbench.panel.markers.view",
  "vscode:view:workbench.panel.output",
  "vscode:view:workbench.panel.repl.view",
  "vscode:view:terminal",
];
/** A borrowed id's prefix: `source: "view"` entries all arrive under this. */
const BORROWED = "vscode:view:";
/** The key `prac-client-ui-layout` persists under (see its `store.ts`). */
const STATE_KEY = "prac-layout/v1";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

// A fresh origin, for the same reason `verify:persistence` clears the key first:
// the gates share one rig, and what an earlier gate placed, hid or selected would
// otherwise decide what this one sees. The claim here is about the arrangement's
// defaults, so the gate starts from the factory shape.
await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__pracLayout, null, { timeout: 60_000 });

// The arrangement runs once the catalogue arrives; its first borrowed placement
// is the signal that the container children exist.
await page.waitForFunction(
  () =>
    globalThis.__pracLayout.listViews().some((view) => (view.region ?? "").includes("/container:")),
  null,
  { timeout: 90_000 },
);
await page.waitForTimeout(1500);

/** Every view the frame knows, placed or not. */
const views = await page.evaluate(() =>
  globalThis.__pracLayout.listViews().map((view) => ({
    id: view.id,
    region: view.region ?? null,
    hidden: view.hidden === true,
  })),
);

/** The container bars, as the page renders them. */
const bars = await page.evaluate(() =>
  [...document.querySelectorAll("[data-prac-container-bar]")].map((bar) => ({
    bar: bar.getAttribute("data-prac-container-bar"),
    items: [...bar.querySelectorAll("[data-prac-container]")].map((item) =>
      item.getAttribute("data-prac-container"),
    ),
    /** The names the bar shows, in the same order as `items`. */
    labels: [...bar.querySelectorAll("[data-prac-container]")].map((item) =>
      (item.textContent ?? "").trim(),
    ),
    active: [...bar.querySelectorAll('[data-prac-container-active="true"]')].map((item) =>
      item.getAttribute("data-prac-container"),
    ),
  })),
);

/**
 * What a region renders right now: its box, its view hosts, the child regions it
 * selects among, and how many of them it shows.
 *
 * @param {string} region - the region id.
 * @returns {Promise<{ box: object, hosts: number[], children: string[], shown: string[], bar: string | null } | null>} the facts.
 */
async function sample(region) {
  return page.evaluate((id) => {
    // A container that holds two visible views is a `column` split of rows, and the split carries
    // the region's id, so both kinds of element answer for it.
    const element =
      document.querySelector(`[data-prac-region="${id}"]`) ??
      document.querySelector(`[data-prac-split="${id}"]`);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      hosts: [...element.querySelectorAll("[data-prac-view-host]")].map((host) =>
        Math.round(host.getBoundingClientRect().height),
      ),
      // The container the track selects may itself be a `column` split (a stack took the region's
      // id), so the elements that answer for a region are both kinds.
      children: [
        ...element.querySelectorAll(":scope > [data-prac-region], :scope > [data-prac-split]"),
      ].map(
        (child) => child.getAttribute("data-prac-region") ?? child.getAttribute("data-prac-split"),
      ),
      shown: [...element.querySelectorAll("[data-prac-region], [data-prac-split]")].map(
        (child) => child.getAttribute("data-prac-region") ?? child.getAttribute("data-prac-split"),
      ),
      bar:
        element
          .querySelector("[data-prac-container-bar]")
          ?.getAttribute("data-prac-container-bar") ?? null,
    };
  }, region);
}

/**
 * Click one bar entry and wait for the frame to render its container.
 *
 * @param {string} container - the container child region to select.
 * @returns {Promise<object | null>} the container's {@link sample}.
 */
async function select(container) {
  const bar = container.slice(0, container.indexOf("/"));
  await page.click(`[data-prac-container-bar="${bar}"] [data-prac-container="${container}"]`);
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-prac-region="${id}"]`) !== null ||
      document.querySelector(`[data-prac-split="${id}"]`) !== null,
    container,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(500);
  return sample(container);
}

/** One visit per bar entry: the container it should show, and what it showed. */
const visits = [];
for (const bar of bars) {
  for (const item of bar.items) {
    const facts = await select(item);
    const outer = await sample(bar.bar);
    visits.push({
      container: item,
      shown: outer?.children ?? [],
      hosts: facts?.hosts ?? [],
      height: facts?.box.h ?? 0,
      innerBar: facts?.bar ?? null,
    });
  }
}

/** What each visited container should hold: its views that are not hidden. */
const placedIn = (container) => views.filter((view) => view.region === container && !view.hidden);

// Measured after re-selecting each one: only the shown container is in the DOM,
// so pixels can only be read from the container the bar was last pointed at.
const colours = {};
for (const container of [EXPLORER, PROBLEMS]) {
  await select(container);
  colours[container] = await distinctColours(page, (await sample(container))?.box);
}

const byId = new Map(bars.map((bar) => [bar.bar, bar]));
const borrowed = (bar) =>
  (byId.get(bar)?.items ?? []).filter((item) => item.includes("/container:"));
const placed = views.filter((view) => view.region !== null && view.id.startsWith(BORROWED));
const deferred = DEFERRED.map(
  (id) => views.find((view) => view.id === id) ?? { id, region: "absent" },
);

const facts = {
  bars,
  visits,
  screens: { borrowed: placed.length, containers: bars.flatMap((bar) => borrowed(bar.bar)).length },
  colours,
  deferred,
};

// ── an empty container says so, instead of the track quietly showing another ──
await page.evaluate((id) => {
  for (const view of globalThis.__pracLayout.listViews()) {
    if ((view.region ?? "").includes("explorer")) globalThis.__pracLayout.hide(view.id);
  }
  const item = document.querySelector(
    `[data-prac-container-bar="left"] [data-prac-container="${id}"]`,
  );
  item?.click();
}, EXPLORER);
await page.waitForTimeout(1200);
const emptyState = await page.evaluate((id) => {
  const item = document.querySelector(
    `[data-prac-container-bar="left"] [data-prac-container="${id}"]`,
  );
  const active = document
    .querySelector('[data-prac-container-active="true"]')
    ?.getAttribute("data-prac-container");
  return {
    markedEmpty: item?.getAttribute("data-prac-container-empty") === "true",
    active,
    pane: document.querySelector(`[data-prac-empty-pane="${id}"]`) !== null,
  };
}, EXPLORER);

await close();

report({
  url,
  facts,
  checks: {
    "the left bar switches between prac's sidebar and the borrowed containers":
      (byId.get(LEFT)?.items ?? []).includes(SIDEBAR) && borrowed(LEFT).length >= 3,
    "the bottom bar switches between the borrowed panel containers":
      (byId.get(BOTTOM)?.items ?? []).includes(TERMINAL) && borrowed(BOTTOM).length >= 3,
    "each bar marks exactly one entry as shown":
      bars.length > 0 && bars.every((bar) => bar.active.length === 1),
    // A container that became a stack must still be **named**: the bar switching between a region's
    // children reads labels, and a split without one shows up as its raw id (`workbench.view.…`).
    "every bar entry is named, none by its raw id": bars.every(
      (bar) =>
        bar.labels.length === bar.items.length &&
        bar.labels.every((label) => label.length > 0 && !label.startsWith("workbench.view.")),
    ),
    // An emptied container is named on the bar and, when picked, says so itself: the click lands on
    // the container the person chose instead of the track silently showing a different one.
    "an empty container is marked and says so when picked":
      emptyState.markedEmpty && emptyState.active === EXPLORER && emptyState.pane,
    "one container at a time, and it is the one clicked":
      visits.length >= 8 &&
      visits.every((visit) => visit.shown.length === 1 && visit.shown[0] === visit.container),
    "a container holds no bar of its own (its children are views, not containers)": visits.every(
      (visit) => visit.innerBar === null,
    ),
    "every view placed in a container has a host with height": visits.every((visit) => {
      const expected = placedIn(visit.container);
      return visit.hosts.length >= expected.length && visit.hosts.every((height) => height > 0);
    }),
    "the borrowed surfaces all arrive": SURFACES.every((id) =>
      placed.some((view) => view.id === id),
    ),
    "the selected container paints": colours[EXPLORER] > 1 && colours[PROBLEMS] > 1,
    "the deferred views are registered but unplaced":
      deferred.length === DEFERRED.length &&
      deferred.every((view) => view.region === null && view.hidden === true),
    "no prac-owned console errors":
      own("__pracLayout").length === 0 && own("vscode-embed:").length === 0,
  },
  ok: "OK: the borrowed containers are named child regions, one is shown at a time, and every view they hold mounts and paints",
});
