/**
 * The **Timeline** pane is upstream's, driven by upstream's timeline service, and follows the
 * active file.
 *
 * Why this needs a provider of its own: a Timeline pane with nothing in it cannot be told apart
 * from a broken one, and the embedded workbench has no timeline source (the git extension
 * contributes none here — measured: the pane renders its chrome and stays empty). So the gate
 * asks the workbench for a **gate-only** provider through its public `ITimelineService`
 * (`__vscodeEmbed.enableTimelineProbe()`), then asserts the *panel*: one row per resource, and
 * the row naming whichever file is active.
 *
 * @module prac/vendor/vscode/scripts/verify-timeline
 */
import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3099/?token=…"');

const [ALPHA, DELTA] = writeFixtures("verify-timeline", url, [
  { name: "prac-timeline-alpha.txt", body: "alpha\n" },
  { name: "prac-timeline-delta.txt", body: "delta\n" },
]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

/** Press like a hand does: instant down+up is not the same gesture (see verify-close). */
const press = async (spot) => {
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(2500);
};

const timeline = () =>
  page.evaluate(() => {
    const entry = globalThis.__deep.one('[data-prac-stack-entry="vscode:view:timeline"]');
    const content = entry
      ?.querySelector("[data-prac-view-host]")
      ?.shadowRoot?.querySelector("[data-prac-view-content]");
    // The list is what the pane renders its entries into (the pane's own class names are the
    // workbench's business; the list's height is the honest "the pane is showing something").
    const pane = content?.querySelector(".monaco-list") ?? null;
    const rows = [...(content?.querySelectorAll(".monaco-list-row") ?? [])].map((row) =>
      (row.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    return {
      mounted: content !== undefined && content !== null,
      paneHeight: pane ? Math.round(pane.getBoundingClientRect().height) : 0,
      rows,
      region:
        globalThis.__deep.closest(entry, "[data-prac-region]")?.getAttribute("data-prac-region") ??
        null,
    };
  });

await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
await page.evaluate(() => globalThis.__vscodeEmbed.face.enableTimelineProbe());
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), ALPHA.uri);
await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
await page.waitForTimeout(5000);

// The Explorer container, then the Timeline entry inside its stack (its header toggles it).
const containerSpot = await page.evaluate(() => {
  const entry = globalThis.__deep.one('[data-prac-container*="workbench.view.explorer"]');
  const box = entry?.getBoundingClientRect();
  return box
    ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    : null;
});
if (containerSpot !== null) await press(containerSpot);
const stackSpot = await page.evaluate(() => {
  const entry = globalThis.__deep.one('[data-prac-stack-entry="vscode:view:timeline"]');
  const box = entry?.getBoundingClientRect();
  return box
    ? { x: Math.round(box.x + Math.min(60, box.width / 2)), y: Math.round(box.y + box.height / 2) }
    : null;
});
if (stackSpot !== null) await press(stackSpot);
const withAlpha = await timeline();

// The next file becomes the active editor: the panel's entries have to follow it.
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), DELTA.uri);
await page.waitForTimeout(4000);
const withDelta = await timeline();

await browser.close();

const checks = {
  thePaneIsUpstreams: withAlpha.mounted && withAlpha.paneHeight > 20,
  theProviderAnswered: withAlpha.rows.length > 0,
  theRowNamesTheActiveFile: withAlpha.rows.some((row) => row.includes("prac-timeline-alpha.txt")),
  itStaysInItsRegion: withAlpha.region === "left/container:workbench.view.explorer",
  itFollowsTheActiveFile:
    withDelta.rows.length > 0 &&
    withDelta.rows.some((row) => row.includes("prac-timeline-delta.txt")) &&
    withDelta.rows.every((row) => !row.includes("prac-timeline-alpha.txt")),
  noEmbedErrors: consoleErrors.filter((line) => line.includes("vscode-embed:")).length === 0,
};
const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
console.log(JSON.stringify({ url, withAlpha, withDelta, checks }, null, 2));
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: the Timeline pane is the workbench's own, its entries come from the timeline service, they name the active file, and switching files switches them.",
);
