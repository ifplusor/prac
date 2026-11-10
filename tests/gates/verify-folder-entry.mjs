/**
 * Gate: the two product entry points for folders.
 *
 * Opens A, then uses the title bar's Open folder input to enter C, and the
 * per-row new-tab action to reopen A in a second tab. Checks the workspace the
 * workbench actually landed on in each case.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrac, report, requireUrl } from "./harness.mjs";
import { installDeepDom } from "../../vendor/vscode/scripts/deep-dom.mjs";
import { installShellModalAccommodation } from "../../scripts/shell-modal.mjs";

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-folder-entry-"));
const A = join(root, "alpha");
const C = join(root, "gamma");
await mkdir(A, { recursive: true });
await mkdir(C, { recursive: true });
await writeFile(join(A, "a.txt"), "alpha\n", "utf8");
await writeFile(join(C, "c.txt"), "gamma\n", "utf8");
const workspaceUrl = (path) => {
  const next = new URL(url);
  next.searchParams.set("workspace", path);
  return next.toString();
};

async function ready(page, folder) {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
  await page.waitForFunction(
    (path) =>
      globalThis.__vscodeEmbed?.face?.workspaceInfo().folders.some((entry) => entry.includes(path)),
    folder,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1_000);
}

const { page, close } = await openPrac(url);
await installDeepDom(page);
await page.goto(workspaceUrl(A), { waitUntil: "load", timeout: 60_000 });
await ready(page, A);

await page.locator(".prac-title-button").first().click();
await page.waitForSelector(".prac-title-menu", { timeout: 10_000 });
const hasInput = (await page.locator(".prac-title-open-input").count()) > 0;
await page.locator(".prac-title-open-input").fill(C);
await page.getByRole("button", { name: "Open", exact: true }).click();
await ready(page, C);
const openedC = await page.evaluate(() => globalThis.__vscodeEmbed.face.workspaceInfo());

const context = page.context();
const popupPromise = context.waitForEvent("page", { timeout: 30_000 });
await page.locator(".prac-title-button").first().click();
await page.waitForSelector(".prac-title-menu", { timeout: 10_000 });
const rowA = page.locator(".prac-title-row", { hasText: A });
await rowA.locator(".prac-title-newtab").click();
const popup = await popupPromise;
await installShellModalAccommodation(popup);
await ready(popup, A);
const tabA = await popup.evaluate(() => globalThis.__vscodeEmbed.face.workspaceInfo());

process.stderr.write(
  `[folder-entry] ${JSON.stringify({ hasInput, openedC, tabA, popupUrl: popup.url() }, null, 2)}\n`,
);

await popup.close();
await close();

report({
  url,
  facts: { hasInput, openedC, tabA },
  checks: {
    "the workspace menu offers an Open folder input": hasInput,
    "Open folder reached C": openedC.folders.some((entry) => entry.includes("gamma")),
    "the new-tab action opened A in a second tab": tabA.folders.some((entry) =>
      entry.includes("alpha"),
    ),
  },
  ok: "OK: Open folder and Open in new tab both reach their target",
});
