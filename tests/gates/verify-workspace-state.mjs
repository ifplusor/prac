/**
 * Diagnostic: does the embedded workbench keep per-workspace state across a
 * page reload?
 *
 * Opt-in. Opens a real file, makes it dirty, reloads, then samples at 0.5 / 2 /
 * 5 / 10s: workspace id, open files, dirty files, storage names. The id check is
 * the one that separates "restore is off" from "the storage key changed".
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrac, requireUrl } from "./harness.mjs";
import { installDeepDom } from "../../vendor/vscode/scripts/deep-dom.mjs";

const selected = (process.env.PRAC_GATES ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("workspace-state");
if (!selected) {
  console.log("SKIPPED: select it explicitly (PRAC_GATES=workspace-state)");
  process.exit(0);
}

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-state-"));
const folder = join(root, "alpha");
await mkdir(folder, { recursive: true });
await writeFile(join(folder, "a.txt"), "alpha\n", "utf8");
const workspaceUrl = () => {
  const next = new URL(url);
  next.searchParams.set("workspace", folder);
  return next.toString();
};
const authority = new URL(url).host;
const file = `vscode-remote://${authority}${join(folder, "a.txt")}`;

const { page, close } = await openPrac(url);
await installDeepDom(page);

const state = () =>
  page.evaluate(async () => {
    const face = globalThis.__vscodeEmbed?.face;
    const dbs =
      globalThis.indexedDB?.databases === undefined
        ? []
        : (await globalThis.indexedDB.databases()).map((db) => db.name);
    return {
      id: face?.workspaceInfo()?.id ?? null,
      folders: face?.workspaceInfo()?.folders ?? [],
      open: face?.listOpenFiles() ?? [],
      dirty:
        face?.capabilities.editors
          .snapshot()
          .filter((entry) => entry.dirty)
          .map((entry) => entry.resource) ?? [],
      localStorageKeys: Object.keys(localStorage).filter(
        (key) => key.includes("vscode") || key.includes("prac") || key.includes("workbench"),
      ),
      indexedDbNames: dbs,
    };
  });

await page.goto(workspaceUrl(), { waitUntil: "load", timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
await page.waitForTimeout(2_500);
const before = await state();

const view = `[data-vscode-embed-file="${file}"]`;
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file);
await page.waitForFunction(
  (selector) =>
    globalThis.__deep.all(selector).some((element) => element.querySelector(".monaco-editor")),
  view,
  { timeout: 60_000 },
);
const spot = await page.evaluate((selector) => {
  const element = globalThis.__deep
    .all(selector)
    .find((entry) => entry.querySelector(".monaco-editor"));
  const box = element?.getBoundingClientRect();
  return box === undefined ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}, view);
if (spot !== null) {
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type("x");
  await page.waitForFunction(
    (uri) =>
      globalThis.__vscodeEmbed.face.capabilities.editors
        .snapshot()
        .some((entry) => entry.resource === uri && entry.dirty),
    file,
    { timeout: 5_000 },
  );
}
const dirty = await state();

const started = Date.now();
await page.reload({ waitUntil: "load", timeout: 60_000 });
const samples = [];
let last = 0;
for (const at of [500, 2_000, 5_000, 10_000]) {
  await page.waitForTimeout(at - last);
  last = at;
  samples.push({ at, state: await state() });
}

process.stderr.write(
  `[workspace-state] ${JSON.stringify(
    {
      before,
      dirty,
      reloadMs: Date.now() - started,
      samples,
    },
    null,
    2,
  )}\n`,
);

await close();
console.log("OK: workspace-state diagnostic recorded (see stderr)");
