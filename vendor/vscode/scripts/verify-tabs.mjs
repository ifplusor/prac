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
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face && !!globalThis.__deep, null, {
  timeout: 60_000,
});
await page.waitForTimeout(5000);

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
      tabs: [...globalThis.__deep.all("[data-prac-tab]")].map((tab) =>
        (tab.getAttribute("data-prac-tab") ?? "").split("/").pop(),
      ),
      front: (globalThis.__pracLayout.activeView() ?? "").split("/").pop(),
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
    };
  });

const tabIdOf = (file) =>
  page.evaluate(
    (name) =>
      globalThis.__pracLayout
        .listViews()
        .map((view) => view.id)
        .find((id) => id.startsWith("vscode:file:") && id.endsWith(name)) ?? null,
    file.name,
  );

step("open three files");
for (const file of [A, B, C]) {
  await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file.uri);
  await page.waitForTimeout(2500);
}
const opened = await facts();

step("click the middle tab");
const bView = await tabIdOf(B);
await page.click(`[data-prac-tab="${bView}"]`);
await page.waitForTimeout(2500);
const clicked = await facts();

step("activate the first file from the app");
await page.evaluate(
  (uri) => globalThis.__vscodeEmbed.face.capabilities.editors.actions.activate(uri),
  A.uri,
);
await page.waitForTimeout(2500);
const activated = await facts();
// Sampled twice: a pair that keeps flipping between the app and prac's front (the storm
// this reconciliation used to fall into) would differ here.
await page.waitForTimeout(2500);
const activatedLater = await facts();

step("drag the first tab onto the third");
const aView = await tabIdOf(A);
const cView = await tabIdOf(C);
await page.dragAndDrop(`[data-prac-tab="${aView}"]`, `[data-prac-tab="${cView}"]`);
await page.waitForTimeout(2500);
const dragged = await facts();

await browser.close();

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const checks = {
  // 1. Open order, and opening a file appends it (the strip is not MRU).
  tabsAreInOpenOrder: same(opened.tabs, ["a.txt", "b.txt", "c.txt"]),
  openingAFilesAppendsIt: opened.front === "c.txt" && opened.surface === "c.txt",
  // 2. Activation does not move a tab: the click changes what is shown, not where.
  clickingKeepsTheOrder: same(clicked.tabs, opened.tabs),
  clickingChangesWhatIsShown: clicked.front === "b.txt" && clicked.surface === "b.txt",
  // 3. Both directions settle: the click pulled the app, and `activate` pulled prac.
  clickPullsTheApp: clicked.app === "b.txt",
  activateKeepsTheOrder: same(activated.tabs, opened.tabs),
  activateFrontsTheFile: activated.front === "a.txt" && activated.surface === "a.txt",
  activatePullsTheApp: activated.app === "a.txt",
  // 4. Dragging is the only thing that reorders, and it changes nothing else.
  dragReorders: same(dragged.tabs, ["b.txt", "c.txt", "a.txt"]),
  dragReordersTheEditorModel: same(dragged.appOrder, ["b.txt", "c.txt", "a.txt"]),
  dragKeepsTheFront: dragged.front === "a.txt" && dragged.surface === "a.txt",
  // 3b. It **stays** that way: a reconciliation that keeps flipping would differ here.
  activateSettles: same(activated, activatedLater),
  noErrors: consoleErrors.filter((line) => line.includes("vscode-embed")).length === 0,
};

console.log(
  JSON.stringify(
    { url, files: [A.name, B.name, C.name], opened, clicked, activated, dragged, checks },
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
