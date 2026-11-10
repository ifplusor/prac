/** Gate: the default screen shows a usable conversation. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPrac, report, requireUrl } from "./harness.mjs";
import { installDeepDom } from "../../vendor/vscode/scripts/deep-dom.mjs";

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-default-screen-"));
await mkdir(root, { recursive: true });
await writeFile(join(root, "a.txt"), "alpha\n", "utf8");
const target = new URL(url);
target.searchParams.set("workspace", root);

const { page, close } = await openPrac(url);
await installDeepDom(page);
await page.goto(target.toString(), { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("prac-")) localStorage.removeItem(key);
  }
});
await page.reload({ waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
await page.waitForTimeout(4_000);
const screen = await page.evaluate(() => {
  const centre = document.querySelector('[data-prac-region="center"]');
  const bottom = document.querySelector('[data-prac-region="bottom"]');
  return {
    centreText: (centre?.innerText ?? "").trim().slice(0, 300),
    bottomHeight: bottom === null ? 0 : Math.round(bottom.getBoundingClientRect().height),
  };
});
await page.screenshot({ path: "/tmp/prac-default-fixed2.png", fullPage: false });
process.stderr.write(`[default-screen] ${JSON.stringify(screen, null, 2)}\n`);
await close();
report({
  url,
  facts: screen,
  checks: {
    "the centre shows a conversation": /Into the Unknown|Describe what you want|Select model/.test(
      screen.centreText,
    ),
    "the bottom is collapsed": screen.bottomHeight <= 1,
  },
  ok: "OK: the default screen shows a usable conversation",
});
