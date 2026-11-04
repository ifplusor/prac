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
import { until } from "../../../tests/gates/until.mjs";
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
      hosts: [...(globalThis.__vscodeEmbed?.fileHosts?.values() ?? [])]
        .filter((host) => host.resource === uri)
        .map((host) => ({
          placement: host.placement,
          connected: host.element.isConnected,
          lines: host.element.querySelectorAll(".view-line").length,
          parentRegion: host.element.parentElement?.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
          width: Math.round(host.element.getBoundingClientRect().width),
        })),
      domRegions: globalThis.__deep
        .all("[data-prac-region]")
        .map((element) => element.getAttribute("data-prac-region")),
      activeWindowOrder: globalThis.__vscodeEmbed?.face?.windowOrder?.() ?? [],
      centerWindowOrder: globalThis.__vscodeEmbed?.face?.windowOrder?.("center") ?? [],
      editors: (globalThis.__vscodeEmbed?.face?.capabilities?.editors?.snapshot() ?? []).map(
        (entry) => ({
          placement: entry.placement,
          group: entry.group,
          region: entry.region,
          active: entry.active,
        }),
      ),
      frameViews: (globalThis.__pracFrame?.listItems() ?? [])
        .filter((view) => view.id.includes(uri))
        .map((view) => ({ id: view.id, region: view.region, hidden: view.hidden, front: view.front })),
    };
  }, FILE.uri);

await page.goto(url, { waitUntil: "load" });
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
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), FILE.uri);
await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
// The starting case is one group with one painted surface; wait for the model
// to agree instead of letting it settle for 5s.
await until(
  page,
  (uri) => {
    const face = globalThis.__vscodeEmbed.face;
    const placements = face.listPlacements().filter((placement) => placement.resource === uri);
    const lines = globalThis.__deep
      .all(`[data-vscode-embed-file="${uri}"]`)
      .map((element) => element.querySelectorAll(".view-line").length);
    return (
      placements.length === 1 &&
      globalThis.__pracFileViews(uri).length === 1 &&
      (lines[0] ?? 0) > 0
    );
  },
  FILE.uri,
  { timeout: 10_000 },
);
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
await until(
  page,
  (uri) =>
    globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === uri).length === 2,
  FILE.uri,
  { timeout: 10_000 },
);
// Two placements can exist before the new region has geometry; the directional
// focus commands read that geometry, so wait for both regions to have a box.
await until(
  page,
  () => {
    const regions = globalThis.__deep.all("[data-prac-region]");
    return (
      regions.length >= 2 &&
      regions.every((region) => {
        const box = region.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
    );
  },
  null,
  { timeout: 10_000 },
);
const after = await state();

// The focus commands are geometry too: LEFT/RIGHT have to land in the region that sits there.
const focused = {};
for (const [side, command] of [
  ["left", "workbench.action.focusLeftGroup"],
  ["right", "workbench.action.focusRightGroup"],
]) {
  const previous = (await state()).activeRegion;
  await page.evaluate((name) => globalThis.__vscodeEmbed.commands.executeCommand(name), command);
  await until(
    page,
    (previousRegion) => {
      const element = document.activeElement;
      const region = element ? globalThis.__deep.closest(element, "[data-prac-region]") : null;
      return (
        region !== null &&
        (region.getAttribute("data-prac-region") ?? null) !== previousRegion
      );
    },
    previous,
    { timeout: 5000 },
  );
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
// 2c. …and the group goes away with its last file. Upstream closes an emptied group
// (`closeEmptyGroups`); in prac that means removing the **region**, which is what this pair of
// assertions locks. Without it the empty group stayed on screen with no way to close it, and —
// because it held the active-editor slot — the next split silently did nothing.
const beforeClose = await page.evaluate(
  (uri) =>
    globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === uri).length,
  FILE.uri,
);
await page.evaluate(() =>
  globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.closeActiveEditor"),
);
await until(
  page,
  ({ uri, before }) =>
    globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === uri).length < before,
  { uri: FILE.uri, before: beforeClose },
  { timeout: 10_000 },
);
const emptied = await state();
await page.evaluate(() =>
  globalThis.__vscodeEmbed.commands.executeCommand("workbench.action.splitEditorToNextGroup"),
);
await until(
  page,
  (uri) =>
    globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === uri).length > 1,
  FILE.uri,
  { timeout: 10_000 },
);
const splitAgain = await state();

// 2d. A **temporary** (preview) editor is temporary in its own group only. `Open to the Side`
// makes a pinned copy, and that copy must not read as temporary — the capability computes
// `preview` per (group, editor). Measured before this: both tabs carried
// `data-prac-tab-preview="true"`, which a person reports as "临时打开时 Open to the Side 不好".
await page.evaluate(
  (uri) => globalThis.__vscodeEmbed.commands.executeCommand("vscode.open", uri, { preview: true }),
  FILE.uri,
);
await until(
  page,
  () =>
    globalThis.__deep
      .all("[data-prac-tab]")
      .some((tab) => tab.getAttribute("data-prac-tab-preview") === "true"),
  null,
  { timeout: 5000 },
);
const readPreviewTabs = () =>
  page.evaluate(() =>
    globalThis.__deep
      .all("[data-prac-tab]")
      .map((tab) => {
        const region = globalThis.__deep.closest(tab, "[data-prac-region]");
        const id = region?.getAttribute("data-prac-region") ?? "";
        return { id, preview: tab.getAttribute("data-prac-tab-preview") };
      })
      .filter((tab) => /^(center|region)/.test(tab.id)),
  );
const beforeSide = await readPreviewTabs();
await page.evaluate(
  (uri) => globalThis.__vscodeEmbed.commands.executeCommand("explorer.openToSide", uri),
  FILE.uri,
);
const tabsBefore = await readPreviewTabs();
await until(
  page,
  (count) => globalThis.__deep.all("[data-prac-tab]").length > count,
  tabsBefore.length,
  { timeout: 5000 },
);
const afterSide = await readPreviewTabs();

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
  // The emptied group takes its region with it, and the next split is not a no-op.
  // The pinned copy beside a temporary one is not temporary itself: the tab that appeared in a
  // **new** region reads as pinned, whatever the groups that were already there read as.
  theSideCopyIsPinned: (() => {
    const before = new Set(beforeSide.map((tab) => tab.id));
    const fresh = afterSide.filter((tab) => !before.has(tab.id));
    return fresh.length > 0 && fresh.every((tab) => tab.preview === "false");
  })(),
  theEmptiedGroupIsRemoved: emptied.regions.length === 1 && emptied.placements.length === 1,
  splittingAgainStillWorks: splitAgain.regions.length === 2 && splitAgain.placements.length === 2,
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
  JSON.stringify(
    { url, fixture: FILE.name, before, after, focused, emptied, splitAgain, commandRan, checks },
    null,
    2,
  ),
);
await browser.close().catch(() => undefined);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: with one group the workbench's Split Editor into Next Group asks the frame for a region, gets one, binds the new group to it, mounts the file there — and LEFT/RIGHT focus lands in the region that actually sits on that side.",
);
