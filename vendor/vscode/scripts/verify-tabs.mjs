/**
 * Verification of the **tab strip's semantics**, which follow VS Code's rather than the
 * frame's first shape:
 *
 *  1. **open order** — tabs sit in the order their views arrived, and opening a file
 *     appends it; the strip is not MRU (it used to be, because "which tab is shown" and
 *     "where the tab sits" were the same field, so the activated tab jumped to the first
 *     position and stayed there);
 *  2. **activation does not move a tab** — clicking a tab, or the app activating a file,
 *     changes which view its region shows and leaves the order alone;
 *  3. **both directions settle** — a click makes the app follow prac's front, and the
 *     app's `activate` makes prac front that file, with neither undoing the other;
 *  4. **dragging reorders and nothing else** — a drag is the only thing that changes the
 *     order, and it does not change which view is front.
 *
 * The fixtures are the gate's own files, opened by URI (see `gate-fixtures.mjs`), so this
 * depends on neither the app's workspace folder nor this repository's contents.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-tabs.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { installDeepDom } from "./deep-dom.mjs";
import { until, windowActionsReady } from "../../../tests/gates/until.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const url = process.env.URL;
if (!url) throw new Error("URL is required, e.g. URL='http://127.0.0.1:3084/?token=…'");
if (!existsSync(join(workDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(workDir, "package.json"));
const { chromium } = require("@playwright/test");

/** Say which phase the gate is in, so a hang leaves evidence. */
const step = (phase) => process.stderr.write(`[verify-tabs] ${phase}\n`);

const [A, B, C] = writeFixtures("tabs", url, [
  { name: "a.txt", body: (token) => `alpha ${token}\nsecond line\nthird line\n` },
  { name: "b.txt", body: (token) => `beta ${token}\nsecond line\nthird line\n` },
  { name: "c.txt", body: (token) => `gamma ${token}\nsecond line\nthird line\n` },
]);

step("boot");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
if ((await page.locator("[data-prac-firstrun]").count()) > 0) {
  const rows = page.locator(".prac-firstrun-row");
  if ((await rows.count()) > 0) {
    await rows.first().click();
  } else {
    const input = page.locator(".prac-firstrun-input");
    if ((await input.count()) > 0) {
      await input.fill(process.cwd());
      await page.locator(".prac-firstrun-button").click();
    }
  }
}
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face && !!globalThis.__deep, null, {
  timeout: 60_000,
});
await until(page, () => globalThis.__pracTest?.frame.listRegions().length > 0, null, {
  timeout: 10_000,
});
await page.waitForTimeout(200);

/**
 * The facts this gate is about.
 *
 * `tabs` is the strip left to right, `front`/`surface` say which view the region shows,
 * and `app` is the app's own active editor — the two states that have to agree.
 */
const facts = () =>
  page.evaluate(() => {
    const surface = globalThis.__deep
      .all("[data-vscode-embed-file]")
      .find((element) => element.querySelector(".monaco-editor"));
    return {
      tabs: [...globalThis.__deep.all("[data-prac-tab]")]
        .map((tab) => (tab.getAttribute("data-prac-tab") ?? "").split("/").pop())
        .filter((name) => ["a.txt", "b.txt", "c.txt"].includes(name ?? "")),
      front: (globalThis.__pracTest?.frame.activeItem() ?? "").split("/").pop(),
      surface: (surface?.getAttribute("data-vscode-embed-file") ?? "").split("/").pop() ?? null,
      app: (
        globalThis.__vscodeEmbed.face.capabilities.editors.snapshot().find((entry) => entry.active)
          ?.resource ?? ""
      )
        .split("/")
        .pop(),
      appOrder: globalThis.__vscodeEmbed.face.capabilities.editors
        .snapshot()
        .map((entry) => entry.resource.split("/").pop())
        .filter((name) => ["a.txt", "b.txt", "c.txt"].includes(name)),
      tabActions: globalThis.__deep.all("[data-prac-window-action]").length,
      groupHeaderActions: globalThis.__deep.all(".prac-window-actions").length,
    };
  });

const tabIdOf = (file) =>
  page.evaluate(
    (name) =>
      globalThis.__pracTest?.frame
        .listItems()
        .map((view) => view.id)
        .find((id) => id.startsWith("vscode:file:") && id.endsWith(name)) ?? null,
    file.name,
  );

step("reset the app's open editors");
// The extension host is server-side and outlives a browser, so an earlier gate's
// files can still be open here. The strip would then carry them, and the app's
// placements would not be the three this gate opens.
await page.evaluate(() => {
  const face = globalThis.__vscodeEmbed.face;
  for (const placement of face.listPlacements()) {
    face.capabilities.editors.actions.close(placement.placement, placement.resource);
  }
});
await until(page, () => globalThis.__vscodeEmbed.face.listPlacements().length === 0, null, {
  timeout: 10_000,
});

step("open three files");
for (const file of [A, B, C]) {
  await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file.uri);
  await until(
    page,
    (name) =>
      globalThis.__deep
        .all("[data-prac-tab]")
        .some((tab) => (tab.getAttribute("data-prac-tab") ?? "").endsWith(name)),
    file.name,
    { timeout: 10_000 },
  );
}
await until(
  page,
  () =>
    (globalThis.__pracTest?.frame.activeItem() ?? "").endsWith("c.txt") &&
    globalThis.__deep
      .all("[data-vscode-embed-file]")
      .some(
        (element) =>
          (element.getAttribute("data-vscode-embed-file") ?? "").endsWith("c.txt") &&
          element.querySelector(".monaco-editor") !== null,
      ),
  null,
  { timeout: 10_000 },
);
// The model is what the strip renders from: wait for the action event, not for
// the buttons, then let the check say whether they rendered.
await windowActionsReady(page, await tabIdOf(C));
const opened = await facts();

step("click the middle tab");
const bView = await tabIdOf(B);
await page.click(`[data-prac-tab="${bView}"]`);
await until(
  page,
  (name) =>
    (globalThis.__pracTest?.frame.activeItem() ?? "").endsWith(name) &&
    globalThis.__deep
      .all("[data-vscode-embed-file]")
      .some(
        (element) =>
          (element.getAttribute("data-vscode-embed-file") ?? "").endsWith(name) &&
          element.querySelector(".monaco-editor") !== null,
      ),
  "b.txt",
);
const clicked = await facts();

step("activate the first file from the app");
const activateAuditBefore = await page.evaluate(() =>
  globalThis.__vscodeEmbed.face.editorModelWriteAudit(),
);
await page.evaluate(
  (uri) => globalThis.__vscodeEmbed.face.capabilities.editors.actions.activate(uri),
  A.uri,
);
await until(
  page,
  (name) =>
    (globalThis.__pracTest?.frame.activeItem() ?? "").endsWith(name) &&
    globalThis.__deep
      .all("[data-vscode-embed-file]")
      .some(
        (element) =>
          (element.getAttribute("data-vscode-embed-file") ?? "").endsWith(name) &&
          element.querySelector(".monaco-editor") !== null,
      ),
  "a.txt",
);
const activated = await facts();
const activateAuditAfter = await page.evaluate(() =>
  globalThis.__vscodeEmbed.face.editorModelWriteAudit(),
);
// Sampled twice: a pair that keeps flipping between the app and prac's front (the storm
// this reconciliation used to fall into) would differ here.
await page.waitForTimeout(500);
const activatedLater = await facts();

step("drag the first tab onto the third");
const aView = await tabIdOf(A);
const cView = await tabIdOf(C);
const dragAuditBefore = await page.evaluate(() =>
  globalThis.__vscodeEmbed.face.editorModelWriteAudit(),
);
await page.dragAndDrop(`[data-prac-tab="${aView}"]`, `[data-prac-tab="${cView}"]`);
await until(
  page,
  (want) =>
    JSON.stringify(
      globalThis.__deep
        .all("[data-prac-tab]")
        .map((tab) => (tab.getAttribute("data-prac-tab") ?? "").split("/").pop())
        .filter((name) => ["a.txt", "b.txt", "c.txt"].includes(name ?? "")),
    ) === JSON.stringify(want),
  ["b.txt", "c.txt", "a.txt"],
);
const dragged = await facts();
const dragAuditAfter = await page.evaluate(() =>
  globalThis.__vscodeEmbed.face.editorModelWriteAudit(),
);

step("split via the tab-strip action");
const regionsBefore = await page.evaluate(() => globalThis.__pracTest?.frame.listRegions().length);
await page.locator('[data-prac-window-action="workbench.action.splitEditor"]').first().click();
await until(
  page,
  (before) => globalThis.__pracTest?.frame.listRegions().length > before,
  regionsBefore,
  {
    timeout: 10_000,
  },
);
const regionsAfter = await page.evaluate(() => globalThis.__pracTest?.frame.listRegions().length);
const splitActionHosts = await page.evaluate(
  () => globalThis.__deep.all("[data-prac-window-actions]").length,
);

step("open the overflow menu");
await page.locator("[data-prac-window-actions-more]").first().click();
await until(page, () => document.querySelector("[data-prac-window-actions-menu]") !== null, null, {
  timeout: 3000,
});
const menu = await page.evaluate(() => {
  const element = document.querySelector("[data-prac-window-actions-menu]");
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  const strip = globalThis.__deep.one("[data-prac-tab-strip]")?.getBoundingClientRect();
  return {
    inBody: element.parentElement === document.body,
    belowStrip: strip === undefined ? false : rect.top >= strip.bottom - 1,
    height: Math.round(rect.height),
  };
});
await page.keyboard.press("Escape");

await browser.close();

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const checks = {
  // 1. Open order, and opening a file appends it (the strip is not MRU).
  tabsAreInOpenOrder: same(opened.tabs, ["a.txt", "b.txt", "c.txt"]),
  fileActionsRenderInTheTabStrip: opened.tabActions > 0,
  noGroupHeaderActions: opened.groupHeaderActions === 0,
  openingAFilesAppendsIt: opened.front === "c.txt" && opened.surface === "c.txt",
  // 2. Activation does not move a tab: the click changes what is shown, not where.
  clickingKeepsTheOrder: same(clicked.tabs, opened.tabs),
  clickingChangesWhatIsShown: clicked.front === "b.txt" && clicked.surface === "b.txt",
  // 3. Both directions settle: the click pulled the app, and `activate` pulled prac.
  clickPullsTheApp: clicked.app === "b.txt",
  activateKeepsTheOrder: same(activated.tabs, opened.tabs),
  activateFrontsTheFile: activated.front === "a.txt" && activated.surface === "a.txt",
  activatePullsTheApp: activated.app === "a.txt",
  appActivateWritesActiveOnly:
    activateAuditAfter.open === activateAuditBefore.open &&
    activateAuditAfter.close === activateAuditBefore.close &&
    activateAuditAfter.move === activateAuditBefore.move &&
    activateAuditAfter.active - activateAuditBefore.active === 1 &&
    activateAuditAfter.externalActive - activateAuditBefore.externalActive === 1 &&
    activateAuditAfter.projectionActive === activateAuditBefore.projectionActive,
  // 4. Dragging is the only thing that reorders, and it changes nothing else.
  dragWritesModelOnce:
    dragAuditAfter.move - dragAuditBefore.move === 1 &&
    dragAuditAfter.projectionMove - dragAuditBefore.projectionMove === 1 &&
    dragAuditAfter.externalMove === dragAuditBefore.externalMove &&
    dragAuditAfter.open === dragAuditBefore.open &&
    dragAuditAfter.close === dragAuditBefore.close,
  dragReorders: same(dragged.tabs, ["b.txt", "c.txt", "a.txt"]),
  dragReordersTheEditorModel: same(dragged.appOrder, ["b.txt", "c.txt", "a.txt"]),
  dragKeepsTheFront: dragged.front === "a.txt" && dragged.surface === "a.txt",
  splitActionCreatesAnotherRegion: regionsAfter > regionsBefore,
  splitGroupHasItsOwnActions: splitActionHosts >= 2,
  overflowMenuEscapesTheStrip:
    menu !== null && menu.inBody === true && menu.belowStrip === true && menu.height > 0,
  // 3b. It **stays** that way: a reconciliation that keeps flipping would differ here.
  activateSettles: same(activated, activatedLater),
  noErrors: consoleErrors.filter((line) => line.includes("vscode-embed")).length === 0,
};

console.log(
  JSON.stringify(
    {
      url,
      files: [A.name, B.name, C.name],
      opened,
      clicked,
      activated,
      dragged,
      dragAuditBefore,
      dragAuditAfter,
      regionsBefore,
      regionsAfter,
      splitActionHosts,
      menu,
      checks,
    },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: tabs stay in open order, activation (from prac or from the app) changes what is shown without moving a tab, and dragging is the only thing that reorders.",
);
