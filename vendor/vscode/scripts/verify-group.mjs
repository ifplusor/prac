/**
 * A **group** is a **region**: the workbench's `Split Editor into Next Group` has to make one.
 *
 * This locks the channel that makes that true. Upstream's editor part adds a group by asking
 * `IEditorGroupsService.addGroup(location, direction)`; in prac the frame owns the region tree,
 * so the group cannot exist before the region that renders it does. The frame answers
 * `createRegionBeside(region, side)` synchronously (the tree is a store update), the host binds
 * the new group to the region id it returns, and the workbench moves the editor into it.
 *
 * Measured before the channel: with a single group the command ran and did nothing (one
 * placement, one view, the region count unchanged) — the only trace was a log line.
 *
 * @module prac/vendor/vscode/scripts/verify-group
 */
import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";

const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3099/?token=…"');

const [FILE] = writeFixtures("verify-group", url, [{ name: "group.txt", body: "one\ntwo\n" }]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

/** What the app and the frame say about the file's placements right now. */
const state = async () =>
  page.evaluate((uri) => {
    const face = globalThis.__vscodeEmbed.face;
    const placements = face.listPlacements().filter((placement) => placement.resource === uri);
    return {
      placements: placements.map((placement) => `${placement.placement}@${placement.region}`),
      regions: [...new Set(placements.map((placement) => placement.region))],
      views: globalThis.__pracFileViews(uri).length,
      lines: globalThis.__deep
        .all(`[data-vscode-embed-file="${uri}"]`)
        .map((element) => element.querySelectorAll(".view-line").length),
      activeRegion: (() => {
        const element = document.activeElement;
        const region = element ? globalThis.__deep.closest(element, "[data-prac-region]") : null;
        return region?.getAttribute("data-prac-region") ?? null;
      })(),
    };
  }, FILE.uri);

await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), FILE.uri);
await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
await page.waitForTimeout(5000);
const before = await state();

const commandRan = await page
  .evaluate(async () => {
    try {
      await globalThis.__vscodeEmbed.commands.executeCommand(
        "workbench.action.splitEditorToNextGroup",
      );
      return "ran";
    } catch (error) {
      return `threw: ${String(error).slice(0, 120)}`;
    }
  })
  .catch((error) => `threw: ${String(error).slice(0, 120)}`);
await page.waitForTimeout(4000);
const after = await state();

// The focus commands are geometry too: LEFT/RIGHT have to land in the region that sits there.
const focused = {};
for (const [side, command] of [
  ["left", "workbench.action.focusLeftGroup"],
  ["right", "workbench.action.focusRightGroup"],
]) {
  await page.evaluate((name) => globalThis.__vscodeEmbed.commands.executeCommand(name), command);
  await page.waitForTimeout(2500);
  focused[side] = (await state()).activeRegion;
}

// 2b. The new group is **usable without a click**: opening to the side activates the region,
// and the pane inside it has to hold the focus — otherwise a person types into nothing. The
// frame mounts this view *after* the open focused it, and moving the pane's DOM blurs it:
// measured before the retry existed, `document.activeElement` was `BODY` and a keystroke left
// the file unchanged.
const focusAndTyping = await page.evaluate((view) => {
  const host =
    globalThis.__deep.one(`[data-prac-stack-entry="${view}"] [data-prac-view-host]`) ??
    globalThis.__deep.one("[data-prac-view-host]");
  const region = host ? globalThis.__deep.closest(host, "[data-prac-region]") : null;
  const active = document.activeElement;
  return {
    region: region?.getAttribute("data-prac-region") ?? null,
    focusInNewRegion: active !== null && active !== document.body,
    line: (globalThis.__deep.one(".view-line")?.textContent ?? "").trim(),
  };
});
await browser.close();

const checks = {
  // 1. The starting point is the case the channel exists for: one group, one surface.
  oneGroupToStart: before.placements.length === 1 && before.views === 1 && before.lines[0] > 0,
  theCommandRan: commandRan === "ran",
  // 2. A second **region** came out of the command, the same file is open in both, and both
  // surfaces show text (the new group's view mounted into the region the frame made).
  aSecondGroupAppeared:
    after.placements.length === 2 && after.regions.length === 2 && after.views === 2,
  theRegionCameFromTheCommand:
    after.regions.includes(before.regions[0]) &&
    after.regions.some((region) => region !== before.regions[0]),
  bothSurfacesShowText: after.lines.length === 2 && after.lines.every((count) => count > 0),
  theNewGroupHoldsTheFocus: focusAndTyping.focusInNewRegion === true,
  // 3. Directional focus follows the tree: LEFT is the region that was already there, RIGHT the
  // one the command added. (The editors capability's `active` is per group and cannot say this.)
  focusLeftLandsInTheOldRegion: focused.left === before.regions[0],
  focusRightLandsInTheNewRegion:
    focused.right !== null &&
    after.regions.includes(focused.right) &&
    focused.right !== focused.left,
  noEmbedErrors: consoleErrors.filter((line) => line.includes("vscode-embed:")).length === 0,
};

const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
console.log(
  JSON.stringify({ url, fixture: FILE.name, before, after, focused, commandRan, checks }, null, 2),
);
await browser.close().catch(() => undefined);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: with one group the workbench's Split Editor into Next Group asks the frame for a region, gets one, binds the new group to it, mounts the file there — and LEFT/RIGHT focus lands in the region that actually sits on that side.",
);
