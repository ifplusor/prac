import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../../..");
const upstreamDir = join(repoRoot, ".build/vscode");
const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const url = process.env.URL;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.getByText("prac-dev", { exact: true }).first().click();
await page.waitForTimeout(8000);
await page.screenshot({ path: ".build/dsh-prac.png" });

const facts = {
  url: page.url(),
  hasSpaces: await page.getByTitle("Spaces").count(),
  spaceLabel: await page.getByTitle("Spaces").first().textContent().catch(() => null),
  errors,
};

// Open the Space menu, create a Space, and confirm it became active.
if (facts.hasSpaces > 0) {
  await page.getByTitle("Spaces").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /New Space/ }).first().click();
  await page.waitForTimeout(800);
  facts.afterCreate = await page.getByTitle("Spaces").first().textContent();
  await page.screenshot({ path: ".build/dsh-prac-space.png" });
}

console.log(JSON.stringify(facts, null, 2));
await browser.close();
