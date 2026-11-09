/**
 * Probe: what does a project-folder switch actually cost?
 *
 * Not an acceptance gate: it measures, then reports. It switches between two
 * throwaway folders through the same `?workspace=` navigation the title bar uses
 * (`location.replace`), and records:
 *
 *  - shell-ready and first-editor-ready times for the first folder, a same-folder
 *    reload, and A → B / B → A;
 *  - whether open editors and dirty buffers survive a reload and a switch;
 *  - whether the frame layout (a resized left track) is restored per folder.
 *
 * Opt-in: the full acceptance run skips it. Run it with
 * `vp run verify:ui -- switch-cost` (or `PRAC_GATES=switch-cost`).
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrac, report, requireUrl } from "./harness.mjs";
import { installDeepDom } from "../../vendor/vscode/scripts/deep-dom.mjs";

const explicitlySelected = (process.env.PRAC_GATES ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("switch-cost");
if (!explicitlySelected && process.env.PRAC_PROBE !== "1") {
  console.log("SKIPPED: select it explicitly (PRAC_GATES=switch-cost) or set PRAC_PROBE=1");
  process.exit(0);
}

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-switch-"));
const FOLDER_A = join(root, "alpha");
const FOLDER_B = join(root, "beta");
await mkdir(FOLDER_A, { recursive: true });
await mkdir(FOLDER_B, { recursive: true });
await writeFile(join(FOLDER_A, "a.txt"), "alpha\n", "utf8");
await writeFile(join(FOLDER_B, "b.txt"), "beta\n", "utf8");

const workspaceUrl = (path) => {
  const next = new URL(url);
  next.searchParams.set("workspace", path);
  return next.toString();
};
const authority = new URL(url).host;
const fileUri = (path) => `vscode-remote://${authority}${path}`;
const A_FILE = fileUri(join(FOLDER_A, "a.txt"));

const { page, close } = await openPrac(url);
await installDeepDom(page);

/** Wait for the page to be a working workbench on `path`. */
async function ready(path) {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (folder) =>
      globalThis.__vscodeEmbed.face.workspaceInfo().folders.some((entry) => entry.includes(folder)),
    path,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => globalThis.__pracTest?.frame.listRegions().length > 0, null, {
    timeout: 60_000,
  });
}

/** Time one navigation to `path` until the shell is ready. */
async function timed(label, action, path) {
  const started = Date.now();
  await action();
  await ready(path);
  return { label, ms: Date.now() - started };
}

/** Open one file and time how long until its editor surface exists. */
async function openAndWait(uri) {
  const started = Date.now();
  const view = `[data-vscode-embed-file="${uri}"]`;
  await page.evaluate((resource) => globalThis.__vscodeEmbed.face.openFile(resource), uri);
  await page.waitForFunction(
    (selector) =>
      globalThis.__deep.all(selector).some((element) => element.querySelector(".monaco-editor")),
    view,
    { timeout: 60_000 },
  );
  return Date.now() - started;
}

/** What a person would care about after the switch. */
const state = () =>
  page.evaluate(() => ({
    folder: globalThis.__vscodeEmbed.face.workspaceInfo().folders?.[0] ?? null,
    open: globalThis.__vscodeEmbed.face.listOpenFiles(),
    dirty: globalThis.__vscodeEmbed.face.capabilities.editors
      .snapshot()
      .filter((entry) => entry.dirty)
      .map((entry) => entry.resource),
    scopedKeys: Object.keys(localStorage).filter(
      (key) =>
        key.startsWith("prac-layout/v1/") ||
        key.startsWith("prac-space/v1/") ||
        key.startsWith("prac-spaces/v1/"),
    ).length,
    leftWidth: Math.round(
      document.querySelector('[data-prac-region="left"]')?.getBoundingClientRect().width ?? 0,
    ),
  }));

/** Make the open file dirty through a real keystroke. */
async function makeDirty(uri) {
  const view = `[data-vscode-embed-file="${uri}"]`;
  const spot = await page.evaluate((selector) => {
    const element = globalThis.__deep
      .all(selector)
      .find((entry) => entry.querySelector(".monaco-editor"));
    const box = element?.getBoundingClientRect();
    return box === undefined ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, view);
  if (spot === null) return;
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type("x");
  await page.waitForFunction(
    (resource) =>
      globalThis.__vscodeEmbed.face.capabilities.editors
        .snapshot()
        .some((entry) => entry.resource === resource && entry.dirty),
    uri,
    { timeout: 5_000 },
  );
}

const times = [];
const states = {};

times.push(
  await timed("first A", () => page.goto(workspaceUrl(FOLDER_A), { waitUntil: "load" }), FOLDER_A),
);
times.push({ label: "open first editor in A", ms: await openAndWait(A_FILE) });
await makeDirty(A_FILE);
states.beforeReload = await state();

times.push(await timed("reload A", () => page.reload({ waitUntil: "load" }), FOLDER_A));
await page.waitForTimeout(2_500);
states.afterReload = await state();
if (states.afterReload.open.length === 0) {
  times.push({ label: "reopen after reload", ms: await openAndWait(A_FILE) });
}
if (states.afterReload.dirty.length === 0) {
  await makeDirty(A_FILE);
}
await page.evaluate(() => globalThis.__pracTest?.frame.setWidth("left", 340));
await page.waitForTimeout(500);
states.beforeSwitch = await state();

times.push(
  await timed("A → B", () => page.goto(workspaceUrl(FOLDER_B), { waitUntil: "load" }), FOLDER_B),
);
await page.waitForTimeout(2_500);
states.inB = await state();

times.push(
  await timed("B → A", () => page.goto(workspaceUrl(FOLDER_A), { waitUntil: "load" }), FOLDER_A),
);
await page.waitForTimeout(2_500);
states.back = await state();
if (states.back.open.length === 0) {
  times.push({ label: "reopen after switch", ms: await openAndWait(A_FILE) });
}
states.backAfterReopen = await state();

// The workbench's own openFolder: does it switch in place, without a page
// navigation? Recorded as a fact; it is known to be a no-op in this embed.
const inPlaceBefore = await page.evaluate(() => ({
  href: location.href,
  origin: performance.timeOrigin,
  info: globalThis.__vscodeEmbed.face.workspaceInfo(),
}));
await page.evaluate(
  (folder) => globalThis.__vscodeEmbed.face.openWorkspaceFolder(folder),
  FOLDER_B,
);
await page.waitForTimeout(2_000);
const inPlaceAfter = await page.evaluate(() => ({
  href: location.href,
  origin: performance.timeOrigin,
  info: globalThis.__vscodeEmbed.face.workspaceInfo(),
}));
states.inPlace = {
  before: inPlaceBefore,
  after: inPlaceAfter,
  changed: inPlaceBefore.info.folders.join() !== inPlaceAfter.info.folders.join(),
};

await close();

process.stderr.write(`[switch-cost] ${JSON.stringify({ times, states }, null, 2)}\n`);

report({
  url,
  facts: { folders: { FOLDER_A, FOLDER_B }, times, states },
  checks: {
    "first load reaches workbench A": states.beforeReload.folder.includes("alpha"),
    "switch reaches workbench B": states.inB.folder.includes("beta"),
    "switch back reaches workbench A": states.back.folder.includes("alpha"),
  },
  ok: "OK: switch cost measured (see facts.times and the buffer state after each navigation)",
});
