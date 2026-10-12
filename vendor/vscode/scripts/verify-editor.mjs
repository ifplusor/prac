/**
 * Verification of the **editor host**: the surface prac shows *is* the workbench's editor.
 *
 * This is the gate for the round that replaced the off-screen editor part with prac's own
 * editor host (see `.agents/notes/in-progress/2026-10-07-editor-host.md`). Before it, the
 * page carried **two editors over one model**: a visible `CodeEditorWidget` and the
 * workbench's own pane parked at `left: -100000px`, with the workbench's actions landing
 * on the invisible one. Both halves of that claim are what this gate refuses to take on
 * faith:
 *
 *  1. **there is no second world** — no off-screen part element, no part host anywhere on
 *     the page, and the file's text rendered in exactly **one** editing surface;
 *  2. **a workbench action lands on the visible editor** — find-in-file is driven by real
 *     keys through the workbench's own find widget, and the surface that *prac shows* is the
 *     one that moves: its rendered lines change (the editor scrolls to the match), in the
 *     same host element, with the workbench still agreeing that this file is its active
 *     editor. 转到符号 would be the other path, and it is **unreachable in this
 *     composition** (the float layer takes neither pointer events nor focus), so it belongs
 *     to the float-layer work rather than here.
 *
 * The fixtures are written by the gate and opened by URI, so it depends on neither the
 * folder the app happens to have open nor on this repository's contents. The symbol has to
 * come from a real language service, hence a TypeScript fixture: the same route
 * `verify-outline` uses (VS Code's bundled `typescript-language-features`).
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-editor.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const url = process.env.URL;

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
if (!existsSync(join(workDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(workDir, "package.json"));
const { chromium } = require("@playwright/test");

/** The element marking a part mounted off-screen by the *old* composition. */
const DETACHED = "[data-vscode-embed-detached]";
/** The element marking a part mounted into prac's frame. */
const PART_HOST = "[data-vscode-embed-part-host]";
/** A file view's host element (one per placement). */
const FILE_HOST = "[data-vscode-embed-file]";

/** Where the phase is, on stderr, so a hung gate says which step hung. */
const step = (phase) => process.stderr.write(`[verify-editor] ${phase}\n`);

/**
 * The fixture: the definition is far enough down that revealing it must **scroll**.
 *
 * The first line carries the run's token, so "the editor shows this file" is a claim about
 * the file on disk, and the two markers are what the assertions read back out of the
 * rendered text — no line numbers are assumed. The file is longer than any editor pane
 * (measured the hard way: at 31 lines the whole file fits, so nothing scrolls and the
 * assertion cannot tell a jump from a no-op).
 */
const [PROBE] = writeFixtures("editor", url, [
  {
    name: "prac-editor-probe.ts",
    body: (token) =>
      [
        `// top-${token}`,
        ...Array.from({ length: 200 }, (_, index) => `// filler ${index + 2}`),
        "export class GateTarget {",
        "  method(): number {",
        "    return 7;",
        "  }",
        "}",
      ].join("\n"),
  },
]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

step("boot");
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await installDeepDom(page);
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });

step("open the fixture");
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), PROBE.uri);
await waitDeep(page, `${FILE_HOST} .monaco-editor`);
// Monaco paints after the grid lays it out, and the language service answers after that.
await page.waitForTimeout(6000);

/**
 * What the page shows right now: the surfaces, and the rendered text of the one prac shows.
 *
 * `surfaces` counts every host element carrying the fixture's resource, so "one editor, not
 * two" is a count rather than a belief; `text` is the front surface's rendered lines, which
 * is what an action has to move.
 */
async function sample() {
  return page.evaluate(
    ({ resource, detached, partHost, fileHost }) => {
      const hosts = globalThis.__deep.all(fileHost);
      const mine = hosts.filter(
        (element) => element.getAttribute("data-vscode-embed-file") === resource,
      );
      const shown = mine.find((element) => element.querySelector(".view-line") !== null) ?? null;
      const lines = [...(shown?.querySelectorAll(".view-line") ?? [])].map((element) =>
        (element.textContent ?? "").replace(/\u00a0/g, " "),
      );
      return {
        detachedParts: globalThis.__deep.all(detached).length,
        partHosts: globalThis.__deep.all(partHost).length,
        surfaces: hosts.length,
        mySurfaces: mine.length,
        placement: shown?.getAttribute("data-vscode-embed-placement") ?? null,
        region:
          globalThis.__deep
            .closest(shown, "[data-prac-region]")
            ?.getAttribute("data-prac-region") ?? null,
        renderedLines: lines.length,
        text: lines.join("\n"),
        appActive:
          globalThis.__vscodeEmbed.face.capabilities.editors
            .snapshot()
            .find((entry) => entry.active)?.resource ?? null,
      };
    },
    { resource: PROBE.uri, detached: DETACHED, partHost: PART_HOST, fileHost: FILE_HOST },
  );
}

const before = await sample();

step("move the editor through the workbench's own UI");
// **Find in file**, driven by real keys: Ctrl/Cmd+F opens the workbench's own find widget
// *inside the editor pane*, the symbol's name is typed into it, and Enter finds it — which
// makes the editor reveal (and therefore scroll to) that line. It is the person's gesture
// on the workbench's own UI, and what it moves has to be the surface prac shows.
//
// The two other candidates are deliberately not the path here. 转到符号 (the quick input) is
// **unreachable in this composition**: the workbench's float layer takes no pointer events
// (`elementFromPoint` at a picker row returns `body`) and no focus, so that is a finding of
// its own — the float-layer work, not this gate. Clicking a symbol in the Outline does work
// as a gesture, but the reveal it performs is deferred (measured: the row selects and the
// editor does not scroll), so it would test the wrong thing here.
await page.keyboard.press("ControlOrMeta+F");
await waitDeep(page, ".find-widget");
await page.waitForTimeout(500);
await page.keyboard.type("GateTarget");
await page.waitForTimeout(500);
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
const after = await sample();

await browser.close();

const checks = {
  // 1. There is no second world: the retired off-screen part is gone, no part is hosted in
  // prac's frame, and the file's editing surface is one element (the very failure the round
  // was about was two editors over one model, so the count is the assertion).
  noOffScreenPart: before.detachedParts === 0 && after.detachedParts === 0,
  noPartHosted: before.partHosts === 0 && after.partHosts === 0,
  oneSurfaceForTheFile: before.mySurfaces === 1 && after.mySurfaces === 1,
  // 2. The action landed on the visible editor: the revealed symbol's text is rendered, the
  // top of the file no longer is (so the view scrolled rather than the text changing), the
  // same host element is still the one showing it, and it stayed in its region.
  symbolIsRendered: after.text.includes("GateTarget") && after.text.includes("return 7;"),
  viewScrolledToIt:
    before.text.includes(`top-${PROBE.token}`) &&
    before.text.includes("GateTarget") === false &&
    after.text.includes(`top-${PROBE.token}`) === false,
  sameSurfaceMoved:
    after.placement !== null &&
    after.placement === before.placement &&
    after.region === before.region,
  stillAPaintedEditor: after.renderedLines > 2,
  // 3. The two halves still agree about which file is current — the workbench did the work,
  // and prac's surface is showing the result.
  appStillHasTheFileActive: after.appActive === PROBE.uri,
  // A mount failure is logged by the composition rather than thrown at the embedder.
  noMountErrors: consoleErrors.filter((line) => line.includes("vscode-embed")).length === 0,
};

console.log(
  JSON.stringify(
    {
      url,
      fixture: { name: PROBE.name, token: PROBE.token },
      before: { ...before, text: before.text.split("\n").slice(0, 3) },
      after: { ...after, text: after.text.split("\n").slice(0, 3) },
      checks,
    },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([name]) => name);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: no off-screen editor and no part host exist, the file has exactly one editing surface, and a workbench action (find in file) moves the surface prac shows — in place, with the workbench still on the same file.",
);
