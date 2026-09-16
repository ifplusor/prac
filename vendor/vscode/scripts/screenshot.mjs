/**
 * Capture the fused surface for visual review.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' [OUT=.build/dsh-page.png] node scripts/screenshot.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const upstreamDir = join(
  process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"),
  "upstream",
);
const url = process.env.URL;
const out = resolve(repoRoot, process.env.OUT ?? ".build/dsh-page.png");
if (!url) throw new Error("URL is required");
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test")))
  throw new Error("run vscode:build first");

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: {
    width: Number(process.env.WIDTH ?? 1600),
    height: Number(process.env.HEIGHT ?? 1000),
  },
  deviceScaleFactor: 2,
});
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(Number(process.env.SETTLE ?? 4000));
await page.screenshot({ path: out });
console.log(out);
await browser.close();
