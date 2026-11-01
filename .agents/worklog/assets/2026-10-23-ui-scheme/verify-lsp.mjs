import { createRequire } from "node:module";
import { installDeepDom } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
import { writeFixtures } from "../../../../vendor/vscode/scripts/gate-fixtures.mjs";
const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url = process.env.URL;
const [TS, MD] = writeFixtures("lsp", url, [
  { name: "symbols.ts", body: "interface Alpha { value: number; }\nclass Beta { method(): void {} }\n" },
  { name: "headings.md", body: "# Title\n\n## Section\n\n### Sub\n" },
]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (m) => { if (m.type() === "error" || m.text().includes("PRACMD")) console.log("CONSOLE", m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
if (await page.$("[data-prac-firstrun]")) {
  await page.locator("[data-prac-firstrun] button", { hasText: "prac-dev" }).first().click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(3000);
}
await page.waitForTimeout(6000);

async function outline() {
  return page.evaluate(() => {
    const entry = [...document.querySelectorAll("[data-prac-stack-entry]")].find(
      (el) => el.getAttribute("data-prac-stack-entry") === "vscode:view:outline",
    );
    const content = entry?.querySelector("[data-prac-view-host]")?.shadowRoot?.querySelector("[data-prac-view-content]");
    const message = content?.querySelector(".outline-message");
    return {
      mounted: !!content,
      message: (message?.textContent ?? "").trim(),
      symbols: [...(content?.querySelectorAll(".monaco-list-row") ?? [])].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
      crumbs: (globalThis.__deep?.all(".monaco-breadcrumb-item") ?? []).map((el) => (el.textContent ?? "").trim()),
    };
  });
}

for (const file of [TS, MD]) {
  await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file.uri);
  await page.waitForTimeout(8000);
  await page.evaluate(() => { globalThis.__pracLayout.setViewCollapsed("vscode:view:outline", false); globalThis.__pracLayout.setViewSize("vscode:view:outline", 320); });
  await page.waitForTimeout(3000);
  console.log(file.name, JSON.stringify(await outline(), null, 2));
  await page.screenshot({ path: new URL(`./lsp-${file.name.replaceAll(".", "-")}.png`, import.meta.url).pathname });
}
await browser.close();
