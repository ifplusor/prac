/**
 * A stack entry's height is the person's to set, and it is remembered.
 *
 * The entries of a stack share the height equally by default, and the only control used to be
 * folding the others — which is not "make this one taller", it is "hide the rest". Upstream's
 * viewlets are resized by dragging the boundary between them, so a stack entry's **bottom edge**
 * is a handle: dragging it gives that entry the new height, the rest share what is left, and the
 * size lands in the view record and therefore in the persisted layout.
 *
 * The handle is a hit zone on the entry itself — the listener is on the **capture** phase,
 * because the press lands on the view's own DOM (the workbench's tree) which may stop the event
 * — and a pseudo-element draws the affordance: nothing is added to the DOM, so the stack's
 * children stay exactly its entries and the view body keeps its shape.
 *
 * **Three independent facts, three pages.** Synthetic pointer input is order- and
 * rhythm-sensitive (measured: a click into the tree first left the handle dead, and a denser
 * drag moved nothing), so each fact gets its own load of the page: a drag on an untouched stack,
 * a **negative** press in the middle of an entry, and — after a reload — the size the layout
 * restored.
 *
 * @module prac/vendor/vscode/scripts/verify-stack-size
 */
import { createRequire } from "node:module";
import { installDeepDom } from "./deep-dom.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=…"');

const FILE_VIEW = "vscode:view:workbench.explorer.fileView";
/** Ask for far more than the stack can give: the floors are what has to hold. */
const DRAG = 400;
/** The drag moves the entry by the size of the last step that lands, so ask for less. */
const GREW_ENOUGH = 30;
/** The floor the frame keeps for every entry that is not being dragged (`MIN_ENTRY`). */
const FLOOR = 46;
const browser = await chromium.launch();
const consoleErrors = [];

/** One fresh page, booted and showing the Explorer container (the stack only exists then). */
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  await installDeepDom(page);
  const boot = async () => {
    await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
    await page.waitForTimeout(8000);
  };
  const show = async () => {
    const spot = await page.evaluate(() => {
      const node = globalThis.__deep.one('[data-prac-container*="workbench.view.explorer"]');
      const box = node?.getBoundingClientRect();
      return box
        ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
        : null;
    });
    if (spot === null) return;
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(1500);
  };
  await page.goto(url, { waitUntil: "load" });
  await boot();
  return { page, boot, show };
};

/** The file view's entry height, its neighbour's, and the size the layout carries. */
const measure = (page) =>
  page.evaluate((view) => {
    const height = (id) => {
      const node = globalThis.__deep.one(`[data-prac-stack-entry="${id}"]`);
      return node ? Math.round(node.getBoundingClientRect().height) : null;
    };
    const raw = JSON.parse(localStorage.getItem("prac-layout/v1") ?? "null");
    const entries = globalThis.__deep.all("[data-prac-stack-entry]").map((node) => ({
      view: node.getAttribute("data-prac-stack-entry"),
      height: Math.round(node.getBoundingClientRect().height),
      handle: node.getAttribute("data-prac-stack-handle"),
    }));
    const last = entries.at(-1);
    const region = globalThis.__deep.one('[data-prac-region="left/container:workbench.view.explorer"]');
    return {
      stackHeight: region ? Math.round(region.getBoundingClientRect().height) : null,
      fileView: height(view),
      neighbour: height("vscode:view:outline"),
      persisted: raw?.views?.[view]?.size ?? null,
      lastView: last?.view ?? null,
      lastHeight: last?.height ?? null,
      lastHandle: last?.handle ?? null,
      lastPersisted: last?.view ? (raw?.views?.[last.view]?.size ?? null) : null,
      entries,
    };
  }, FILE_VIEW);

const point = (page, edge, last = false) =>
  page.evaluate(
    ({ view, edge, last }) => {
      const node = last
        ? globalThis.__deep.all("[data-prac-stack-entry]").at(-1)
        : globalThis.__deep.one(`[data-prac-stack-entry="${view}"]`);
      const box = node?.getBoundingClientRect();
      if (!box) return null;
      return {
        x: Math.round(box.x + Math.min(box.width / 2, 60)),
        y: Math.round(edge ? box.bottom - 2 : box.top + box.height / 2),
      };
    },
    { view: FILE_VIEW, edge, last },
  );

/** Four moves with real pauses: the rhythm that was measured to work. */
const drag = async (page, from, deltaY) => {
  if (from === null) return;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(150);
  for (const step of [10, 40, 120, deltaY]) {
    await page.mouse.move(from.x, from.y + step);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
};

// 1. The drag itself, on a stack nobody has touched yet.
const first = await open();
await first.show();
const before = await measure(first.page);
await drag(first.page, await point(first.page, true), DRAG);
const dragged = await measure(first.page);
await first.page.close();

// 2. The negative case in its own page: a press in the middle is a click on the view.
const second = await open();
await second.show();
const plainBefore = await measure(second.page);
await drag(second.page, await point(second.page, false), DRAG);
const plainAfter = await measure(second.page);
await second.page.close();

// 3. What the layout restored: reload, and the entry must come back at the size it kept.
const third = await open();
await third.page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("prac-layout/v1"));
  raw.views["vscode:view:workbench.explorer.fileView"] = {
    ...raw.views["vscode:view:workbench.explorer.fileView"],
    size: 210,
  };
  localStorage.setItem("prac-layout/v1", JSON.stringify(raw));
});
await third.page.reload({ waitUntil: "load" });
await third.boot();
await third.show();
const restored = await measure(third.page);
await third.page.close();

// 4. The **last** entry ends at the stack's own edge: that edge is not a boundary, so dragging
// it must do nothing at all (a person passes there on the way to what is below the stack).
const fourth = await open();
await fourth.show();
const lastBefore = await measure(fourth.page);
await drag(fourth.page, await point(fourth.page, true, true), DRAG);
const lastAfter = await measure(fourth.page);
await fourth.page.close();

await browser.close();

const checks = {
  draggingTheBottomEdgeGrowsTheEntry:
    (dragged.fileView ?? 0) - (before.fileView ?? 0) >= GREW_ENOUGH,
  // The boundary sits at the dragged entry's *bottom*: the room comes from the entry below it.
  theEntryBelowGivesUpRoom: (() => {
    const at = dragged.entries.findIndex((entry) => entry.view === FILE_VIEW);
    const beforeBelow = before.entries[at + 1]?.height ?? 0;
    const afterBelow = dragged.entries[at + 1]?.height ?? 0;
    return at !== -1 && afterBelow < beforeBelow;
  })(),
  // The entries add up to the stack after a drag: the room came from the neighbours, so nothing
  // had to be clamped and nothing is left over.
  theEntriesStillAddUpToTheStack:
    dragged.entries.length > 0 &&
    Math.abs(dragged.entries.reduce((total, entry) => total + entry.height, 0) - dragged.stackHeight) <= 8,
  // Dragging far past what the stack can give still leaves every other entry its floor.
  everyOtherEntryKeepsItsFloor: dragged.entries
    .filter((entry) => entry.view !== FILE_VIEW)
    .every((entry) => entry.height >= FLOOR),
  // The boundary is *between* entries: the last one has none, so its bottom edge is inert.
  theLastEntryHasNoHandle: lastBefore.lastHandle === "false",
  theLastEntryCannotBeDragged:
    lastAfter.lastHeight === lastBefore.lastHeight && lastAfter.lastPersisted === null,
  theSizeIsWritten:
    dragged.persisted !== null && Math.abs(dragged.persisted - dragged.fileView) <= 2,
  theMiddleIsNotAHandle: Math.abs((plainAfter.fileView ?? 0) - (plainBefore.fileView ?? 0)) <= 2,
  // The layout is the memory: the size it holds is the size the entry is drawn at.
  aWrittenSizeIsRestored:
    Math.abs((restored.fileView ?? 0) - 210) <= 3 && restored.persisted === 210,
  noEmbedErrors: consoleErrors.filter((line) => line.includes("vscode-embed:")).length === 0,
};
const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
console.log(
  JSON.stringify(
    { url, before, dragged, plainBefore, plainAfter, restored, lastBefore, lastAfter, checks },
    null,
    2,
  ),
);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: dragging a stack entry's bottom edge resizes it (a press in the middle does not), the neighbour gives up the room, and the size in the layout is the size it is drawn at.",
);
