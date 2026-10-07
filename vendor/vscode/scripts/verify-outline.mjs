/**
 * Verification of the **Outline following the active file** — the live claim that a
 * file's symbols reach the view that is supposed to show them.
 *
 * The Outline is not a consumer of the file; it is a consumer of the workbench's
 * *active editor pane*, and it only answers when the workbench's outline service
 * has a creator that matches that pane. Two things have to hold, and neither is
 * visible in a unit test:
 *
 *  1. **the workbench reached its `Eventually` phase** — the document-symbols
 *     outline creator is registered there (along with 76 other contributions in
 *     this build). An embedded workbench that stops at `Restored` renders
 *     perfectly and silently answers "The active editor cannot provide outline
 *     information" for every file. This gate is what makes that visible;
 *  2. **the Outline follows the file that was opened** — opening a second file
 *     with different symbols replaces the first file's outline.
 *
 * The fixture is a CSS file the gate writes itself, because CSS is the language
 * whose provider is available in this rig: the TypeScript/JavaScript language
 * features ship as a *built-in extension* that is not compiled into the server
 * bundle yet (`docs/architecture.md` §7), so a `.ts` fixture would assert the
 * known gap instead of this mechanism. Measured: with the phase missing, a `.ts`
 * file reports "cannot provide"; with it, both report "No symbols found" only for
 * the languages without a provider.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run --filter prac-vscode vscode:verify-outline
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const url = process.env.URL;
if (!url) throw new Error("URL is required, e.g. URL='http://127.0.0.1:3084/?token=…'");

const require = createRequire(join(workDir, "package.json"));
const { chromium } = require("@playwright/test");

/** Where the fixtures live inside the workspace (the folder the app was given). */
const FIXTURE_RELATIVE = ".build/scratch";
const FIXTURE_DIR = join(repoRoot, FIXTURE_RELATIVE);
const FIXTURES = {
  alpha: {
    name: "prac-outline-alpha.css",
    body: ".alpha { color: red; }\n.alpha .beta { color: blue; }\n#gamma { color: green; }\n",
    symbols: [".alpha", ".alpha .beta", "#gamma"],
  },
  delta: {
    name: "prac-outline-delta.css",
    body: "@media screen { .delta { color: black; } }\n.epsilon { color: white; }\n",
    symbols: ["@media screen", ".delta", ".epsilon"],
  },
  // Two languages, because they arrive by different routes: CSS through the
  // language server the deployment wires into `ctx.lsp`, TypeScript through VS
  // Code's own bundled extension (`typescript-language-features` plus the
  // `typescript` package it spawns). A build that compiles one and not the other
  // is exactly the state this gate is here to catch.
  typescript: {
    name: "prac-outline-typescript.ts",
    body: "interface Alpha { value: number; }\nclass Beta { method(): void {} }\n",
    symbols: ["Alpha", "value", "Beta", "method"],
  },
};

for (const fixture of Object.values(FIXTURES)) {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(join(FIXTURE_DIR, fixture.name), fixture.body);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
// The phase is scheduled 2.5s after restore and then runs when the window is idle,
// so give the workbench room to reach it before asserting anything.
await page.waitForTimeout(7000);

const folder = await page.evaluate(
  () => (globalThis.__vscodeEmbed.face.workspaceInfo().folders ?? [])[0] ?? null,
);
if (!folder) throw new Error("the workbench has no workspace folder");

/** The Explorer container, where the arrangement puts the Outline by default. */
await page.click(
  '[data-prac-container-bar="left"] [data-prac-container*="workbench.view.explorer"]',
);
await page.waitForTimeout(2500);

/**
 * The Outline's own state: its message, and the symbols it lists.
 *
 * The pane renders inside the region's isolation root, so the read goes through
 * the stack entry that carries the view id.
 *
 * @returns the outline facts.
 */
async function outline() {
  return page.evaluate(() => {
    const entry = [...document.querySelectorAll("[data-prac-stack-entry]")].find(
      (element) => element.getAttribute("data-prac-stack-entry") === "vscode:view:outline",
    );
    const content = entry
      ?.querySelector("[data-prac-view-host]")
      ?.shadowRoot?.querySelector("[data-prac-view-content]");
    const message = content?.querySelector(".outline-message") ?? null;
    const tree = content?.querySelector(".outline-tree") ?? null;
    const pane = content?.querySelector(".outline-pane") ?? null;
    const height = (element) => (element ? Math.round(element.getBoundingClientRect().height) : 0);
    return {
      mounted: content !== undefined && content !== null,
      message: (message?.textContent ?? "").trim(),
      // The pane's own CSS is scoped under `.monaco-workbench`, which the host has
      // to carry inside the isolation root: without it the message never hides and
      // the tree sizes to its content (measured: 7612px inside a 734px region) —
      // the "Outline loaded, but the UI is wrong" a person sees.
      messageShown: message !== null && getComputedStyle(message).display !== "none",
      treeHeight: height(tree),
      paneHeight: height(pane),
      symbols: [...(content?.querySelectorAll(".monaco-list-row") ?? [])].map((element) =>
        (element.textContent ?? "").replace(/\s+/g, " ").trim(),
      ),
    };
  });
}

/**
 * Open one fixture through the app's own open path and read the Outline.
 *
 * Polls rather than sleeps: a language server answers late (the TypeScript one
 * spawns a process), so a fixed delay would pass on a warm page and fail on a cold
 * one.
 *
 * @param fixture - one of {@link FIXTURES}.
 * @returns the outline facts while that file is the active editor.
 */
async function opened(fixture) {
  await page.evaluate(
    ({ folder: root, relative, name }) =>
      globalThis.__vscodeEmbed.face.openFile(`${root}/${relative}/${name}`),
    { folder, relative: FIXTURE_RELATIVE, name: fixture.name },
  );
  const wanted = fixture.symbols.length;
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(1000);
    const facts = await outline();
    if (facts.symbols.filter((row) => row !== "").length >= wanted) return facts;
  }
  return outline();
}

const first = await opened(FIXTURES.alpha);
const second = await opened(FIXTURES.delta);
const typescript = await opened(FIXTURES.typescript);

const facts = {
  workspaceFolder: folder,
  first,
  second,
  typescript,
  consoleErrors: consoleErrors.map((line) => line.slice(0, 160)).slice(0, 4),
};
console.log(JSON.stringify({ url, ...facts }, null, 2));

const has = (outlineFacts, symbols) =>
  symbols.every((symbol) => outlineFacts.symbols.some((row) => row.startsWith(symbol)));

const checks = {
  "the Outline view is mounted in the page": first.mounted && second.mounted && typescript.mounted,
  "opening a file that has symbols puts them in the Outline": has(first, FIXTURES.alpha.symbols),
  "the Outline follows the next file (the first file's symbols are gone)":
    has(second, FIXTURES.delta.symbols) &&
    FIXTURES.alpha.symbols.every((symbol) => !second.symbols.some((row) => row.startsWith(symbol))),
  // The built-in route: this only passes when `typescript-language-features` was
  // built into the checkout (its `out/` compiled and its `typescript` installed).
  "TypeScript symbols arrive from VS Code's own bundled extension": has(
    typescript,
    FIXTURES.typescript.symbols,
  ),
  // The listing has to be *laid out*, not merely present in the DOM: the pane is
  // sized by the app's own stylesheet, so a missing workbench context shows up as a
  // stale message and a runaway tree rather than as empty rows.
  "every listing is laid out inside its pane, with no stale message": [
    first,
    second,
    typescript,
  ].every(
    (facts) =>
      facts.messageShown === false &&
      facts.treeHeight > 0 &&
      facts.treeHeight <= facts.paneHeight + 2,
  ),
};
const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);

for (const fixture of Object.values(FIXTURES)) {
  rmSync(join(FIXTURE_DIR, fixture.name), { force: true });
}

await browser.close();

if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: the Outline answers for the active file, follows the next one, and is laid out inside its pane — which needs the workbench's Eventually phase and the workbench context class on the host.",
);
