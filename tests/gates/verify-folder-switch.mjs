/**
 * Opt-in: the real folder-switch flow.
 *
 * Opens A, opens/edits a file, switches to B through the title bar (accepting the
 * save prompt), comes back through the title bar, and checks the file is saved
 * and its editor reopened.
 */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrac, report, requireUrl } from "./harness.mjs";
import { installDeepDom } from "../../vendor/vscode/scripts/deep-dom.mjs";

const selected = (process.env.PRAC_GATES ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("folder-switch");
if (!selected) {
  console.log("SKIPPED: select it explicitly (PRAC_GATES=folder-switch)");
  process.exit(0);
}

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-switch-flow-"));
const A = join(root, "alpha");
const B = join(root, "beta");
await mkdir(A, { recursive: true });
await mkdir(B, { recursive: true });
await writeFile(join(A, "a.txt"), "alpha\n", "utf8");
await writeFile(join(B, "b.txt"), "beta\n", "utf8");
const workspaceUrl = (path) => {
  const next = new URL(url);
  next.searchParams.set("workspace", path);
  return next.toString();
};

const { page, close } = await openPrac(url);
await installDeepDom(page);
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

async function ready(path) {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
  await page.waitForFunction(
    (folder) =>
      globalThis.__vscodeEmbed?.face
        ?.workspaceInfo()
        .folders.some((entry) => entry.includes(folder)),
    path,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1_500);
}

const state = () =>
  page.evaluate(() => ({
    folder: globalThis.__vscodeEmbed.face.workspaceInfo().folders?.[0] ?? null,
    open: globalThis.__vscodeEmbed.face.listOpenFiles(),
    dirty: globalThis.__vscodeEmbed.face.capabilities.editors
      .snapshot()
      .filter((entry) => entry.dirty)
      .map((entry) => entry.resource),
  }));

async function menuItems() {
  await page.locator(".prac-title-button").first().click();
  await page.waitForSelector(".prac-title-menu", { timeout: 10_000 });
  const items = await page.locator(".prac-title-menu .prac-title-item").allTextContents();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return items;
}

async function chooseFolder(path) {
  await page.locator(".prac-title-button").first().click();
  await page.waitForSelector(".prac-title-menu", { timeout: 10_000 });
  // The row carries the title and the path; match the path.
  const row = page.locator(".prac-title-menu .prac-title-item", { hasText: path });
  if ((await row.count()) === 0) throw new Error(`folder not in menu: ${path}`);
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await row.first().click();
}

// Register both folders in DSH's workspace list.
await page.goto(workspaceUrl(A), { waitUntil: "load", timeout: 60_000 });
await ready(A);
await page.goto(workspaceUrl(B), { waitUntil: "load", timeout: 60_000 });
await ready(B);
await page.goto(workspaceUrl(A), { waitUntil: "load", timeout: 60_000 });
await ready(A);

const items = await menuItems();
process.stderr.write(`[folder-switch] menu: ${JSON.stringify(items)}\n`);

const file = `vscode-remote://${new URL(url).host}${join(A, "a.txt")}`;
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
const beforeSwitch = await state();

await chooseFolder(B);
await ready(B);
const inB = await state();

await chooseFolder(A);
await ready(A);
const back = await state();
const content = await readFile(join(A, "a.txt"), "utf8");

await close();

process.stderr.write(
  `[folder-switch] ${JSON.stringify({ items, beforeSwitch, inB, back, content, consoleErrors: errors.slice(0, 8) }, null, 2)}\n`,
);

report({
  url,
  facts: { items, beforeSwitch, inB, back, content },
  checks: {
    "the folder menu lists both workspaces":
      items.some((text) => text.includes(A)) && items.some((text) => text.includes(B)),
    "the switch reached B": inB.folder.includes("beta"),
    "the return reached A": back.folder.includes("alpha"),
    "the dirty buffer was saved": content.includes("x"),
    "the file reopened on return": back.open.some((uri) => uri.endsWith("/a.txt")),
  },
  ok: "OK: folder switch saved the dirty file and reopened it on return",
});
