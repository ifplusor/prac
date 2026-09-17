/** Smoke check: boot the independent viewing page (no bridge) and assert the workbench rendered. */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = workDir;
const url = process.env.URL ?? `http://127.0.0.1:${process.env.PORT ?? 5199}/`;

if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

// Resolve Playwright from the upstream checkout (it is one of VS Code's devDependencies).
const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

let rendered = false;
let navError;
try {
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector(".monaco-workbench", { state: "attached", timeout: 60_000 });
  rendered = true;
} catch (error) {
  navError = error instanceof Error ? error.message : String(error);
}

const facts = await page
  .evaluate(() => ({
    entryLoaded: globalThis.__pracEntryLoaded === true,
    hasWorkbench: !!document.querySelector(".monaco-workbench"),
    title: document.title,
    hosts: [...document.querySelectorAll("[data-vscode-embed-part-host]")].map((host) => ({
      part: host.getAttribute("data-vscode-embed-part-host"),
      mounted: !!host.querySelector(".part"),
      boxes: host.querySelectorAll(".part").length,
      html: (host.innerHTML || "").length,
    })),
    editorContent: !!document.querySelector(
      '[data-vscode-embed-part-host="workbench.parts.editor"] .editor-group-container, [data-vscode-embed-part-host="workbench.parts.editor"] .monaco-editor, [data-vscode-embed-part-host="workbench.parts.editor"] .editor-container',
    ),
    statusbarItems: document.querySelectorAll(
      '[data-vscode-embed-part-host="workbench.parts.statusbar"] .statusbar-item',
    ).length,
    sidebarContent: !!document.querySelector(
      '[data-vscode-embed-part-host="workbench.parts.sidebar"] .composite, [data-vscode-embed-part-host="workbench.parts.sidebar"] .pane-composite-part, [data-vscode-embed-part-host="workbench.parts.sidebar"] .monaco-list',
    ),
  }))
  .catch(() => ({}));

console.log(
  JSON.stringify(
    { url, rendered, facts, navError, errorCount: errors.length, errors: errors.slice(0, 10) },
    null,
    2,
  ),
);
await browser.close();
if (!rendered) process.exit(1);
