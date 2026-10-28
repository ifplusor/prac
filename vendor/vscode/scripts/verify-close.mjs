/**
 * Verification of **closing an editor that has unsaved changes**: the question the
 * workbench asks, and what each answer does.
 *
 * What this gate refuses to take on faith:
 *
 *  1. **the question is asked** — a dirty editor's close shows the workbench's own save
 *     confirmation, and the file is still open while it is on screen (measured before
 *     this behaviour existed: the file was closed silently, changes and all);
 *  2. **it is answerable** — the dialog is in the embedder's float layer, which is
 *     click-through except for a list of containers, so "visible but not clickable" is
 *     the failure mode that looks healthy in a screenshot. The gate clicks the buttons
 *     with a real mouse.
 *  3. **Cancel vetoes** — the file stays open, still dirty;
 *  4. **Don't Save discards** — the file closes and its dirty mark goes.
 *
 * The fixture is the gate's own file, opened by URI (see `gate-fixtures.mjs`), so it
 * depends on neither the app's workspace folder nor this repository's contents.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-close.mjs
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
const step = (phase) => process.stderr.write(`[verify-close] ${phase}\n`);

const [DIRTY] = writeFixtures("close", url, [
  { name: "dirty.txt", body: (token) => `dirty ${token}\nsecond line\nthird line\n` },
]);

step("boot");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
if ((await page.locator("[data-prac-firstrun]").count()) > 0) {
  const rows = page.locator(".prac-firstrun-row");
  if ((await rows.count()) > 0) await rows.first().click();
}
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face && !!globalThis.__deep, null, {
  timeout: 60_000,
});
// The editor must be able to open at all before any of this means anything.
await page.waitForTimeout(5000);

/** The state this gate is about: what is open, what is dirty, what is being asked. */
const state = () =>
  page.evaluate(() => {
    const editors = globalThis.__vscodeEmbed.face.capabilities.editors;
    const dialog = globalThis.__deep.one(".monaco-dialog-box");
    const box = dialog?.getBoundingClientRect();
    return {
      open: globalThis.__vscodeEmbed.face.listOpenFiles(),
      dirty: editors
        .snapshot()
        .filter((entry) => entry.dirty)
        .map((entry) => entry.resource),
      dialog:
        dialog === null || dialog === undefined
          ? null
          : {
              message: dialog.querySelector(".dialog-message-text")?.textContent?.trim() ?? "",
              buttons: [...dialog.querySelectorAll(".monaco-button")].map((button) =>
                (button.textContent ?? "").trim(),
              ),
              painted: box !== undefined && box.width > 100 && box.height > 40,
            },
    };
  });

/**
 * Click a dialog button with a real mouse, at its own coordinates.
 *
 * A real click on purpose: the float layer is click-through unless the dialog's
 * container is allowed, and a synthetic `element.click()` would pass whether or not
 * a person could do it.
 *
 * @param label - the button's text.
 * @returns whether a button with that text was found and clicked.
 */
async function clickButton(label) {
  const spot = await page.evaluate((text) => {
    const dialog = globalThis.__deep.one(".monaco-dialog-box");
    const button = [...(dialog?.querySelectorAll(".monaco-button") ?? [])].find(
      (candidate) => (candidate.textContent ?? "").trim() === text,
    );
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
  }, label);
  if (spot === null) return false;
  // A **person-like press**: the dialog closes on the button's own `click`, and an instant
  // synthetic down+up does not produce one — measured, with no delay between them the
  // dialog came back re-asked while a 120ms press closed it. The gate clicks the way a hand
  // does rather than asserting something about zero-length clicks.
  await page.mouse.move(spot.x, spot.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  return true;
}

/** Focus the editor and type one character, so the file has unsaved changes. */
async function makeDirty() {
  const spot = await page.evaluate((uri) => {
    const element = globalThis.__deep
      .all(`[data-vscode-embed-file="${uri}"]`)
      .find((candidate) => candidate.querySelector(".monaco-editor"));
    const box = element?.getBoundingClientRect();
    return box ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + 40) } : null;
  }, DIRTY.uri);
  if (spot === null) throw new Error("no visible editor to type into");
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type("x");
  await page.waitForTimeout(1200);
}

step("open the fixture");
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), DIRTY.uri);
await page.waitForTimeout(3000);
const opened = await state();

step("type into it");
await makeDirty();
const dirty = await state();

step("close it");
await page.evaluate((uri) => {
  const placement = globalThis.__vscodeEmbed.face.listPlacements().find((p) => p.resource === uri);
  globalThis.__vscodeEmbed.face.capabilities.editors.actions.close(placement.placement, uri);
}, DIRTY.uri);
await page.waitForTimeout(2000);
const asked = await state();

step("cancel");
const cancelled = await clickButton("Cancel");
await page.waitForTimeout(1500);
const afterCancel = await state();

step("close again and discard");
await page.evaluate((uri) => {
  const placement = globalThis.__vscodeEmbed.face.listPlacements().find((p) => p.resource === uri);
  globalThis.__vscodeEmbed.face.capabilities.editors.actions.close(placement.placement, uri);
}, DIRTY.uri);
await page.waitForTimeout(2000);
const askedAgain = await state();
const discarded = await clickButton("Don't Save");
await page.waitForTimeout(2000);
const afterDiscard = await state();

await browser.close();

const has = (list, uri) => list.includes(uri);
const checks = {
  // The fixture opened and became dirty by typing, not by a flag the gate set.
  fixtureOpened: has(opened.open, DIRTY.uri) && opened.dirty.length === 0,
  typingMakesItDirty: has(dirty.dirty, DIRTY.uri),
  // 1. Closing it asks, and the file is still there while it asks.
  closeAsksTheQuestion: asked.dialog !== null && has(asked.open, DIRTY.uri),
  theQuestionNamesTheFile: asked.dialog !== null && asked.dialog.message.includes("dirty.txt"),
  theDialogOffersThreeAnswers:
    asked.dialog !== null &&
    ["Don't Save", "Cancel", "Save"].every((label) => asked.dialog.buttons.includes(label)),
  // 2. It is clickable, not merely present.
  theDialogIsPainted: asked.dialog !== null && asked.dialog.painted,
  // 3. Cancel vetoes: still open, still dirty, dialog gone.
  cancelFoundTheButton: cancelled,
  cancelKeepsTheFile: has(afterCancel.open, DIRTY.uri) && has(afterCancel.dirty, DIRTY.uri),
  cancelDismissesTheDialog: afterCancel.dialog === null,
  // 4. Don't Save closes it and clears the mark.
  askingAgainWorks: askedAgain.dialog !== null,
  discardFoundTheButton: discarded,
  discardClosesTheFile: !has(afterDiscard.open, DIRTY.uri) && afterDiscard.dirty.length === 0,
  discardDismissesTheDialog: afterDiscard.dialog === null,
  // The composition logs a failed close rather than throwing at the embedder.
  noErrors: consoleErrors.filter((line) => line.includes("vscode-embed")).length === 0,
};

console.log(
  JSON.stringify(
    {
      url,
      fixture: DIRTY.name,
      opened: { open: opened.open.length, dirty: opened.dirty.length },
      dirty: dirty.dirty.length,
      asked,
      afterCancel: { open: afterCancel.open.length, dirty: afterCancel.dirty.length },
      askedAgain: askedAgain.dialog,
      afterDiscard: { open: afterDiscard.open.length, dirty: afterDiscard.dirty.length },
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
  "OK: closing an editor with unsaved changes asks first — the question names the file, offers Save / Don't Save / Cancel, is clickable, Cancel keeps the file, and Don't Save closes it.",
);
