/**
 * Dump the real stacking chain for one VS part host, so positioning failures are read
 * off computed style instead of guessed at.
 *
 * Usage: URL='http://127.0.0.1:3082/?token=...' [VIEW=vscode:editor] node scripts/inspect-region.mjs
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
const view = process.env.VIEW ?? "vscode:editor";
if (!url) throw new Error("URL is required");
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test")))
  throw new Error("run vscode:build first");

// The DOM marks **part** ids (`PART_HOST_ATTR`); this tool takes a view id, so the
// two are related here rather than assumed equal.
const PART_OF_VIEW = {
  "vscode:editor": "workbench.parts.editor",
  "vscode:sidebar": "workbench.parts.sidebar",
};
const part = PART_OF_VIEW[view] ?? view;

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector(`[data-vscode-embed-part-host="${part}"]`, {
  state: "attached",
  timeout: 60_000,
});
await page.waitForTimeout(2500);

const chain = await page.evaluate((partId) => {
  const host = document.querySelector(`[data-vscode-embed-part-host="${partId}"]`);
  if (!host) return { error: "vs part host not found" };
  const leaf = host.querySelector(
    ".editor-group-container, .monaco-editor, .composite, .monaco-list, .statusbar",
  );
  const describe = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      classes: el.className && typeof el.className === "string" ? el.className.slice(0, 90) : "",
      id: el.id || "",
      position: style.position,
      display: style.display,
      overflow: style.overflow,
      cssTop: style.top,
      cssLeft: style.left,
      w: Math.round(box.width),
      h: Math.round(box.height),
      x: Math.round(box.x),
      y: Math.round(box.y),
    };
  };
  const ancestors = [];
  for (let el = leaf ?? host; el; el = el.parentElement) {
    ancestors.push(describe(el));
    if (el === host) break;
    if (ancestors.length > 14) break;
  }
  return {
    hostIsPositioned: getComputedStyle(host).position,
    hostInlineStyle: host.getAttribute("style"),
    hostChildren: [...host.children].map(describe),
    hasGridElement: !!host.querySelector(".monaco-grid-view"),
    gridChildren: [...(host.querySelector(".monaco-grid-view")?.children ?? [])].map(describe),
    splitViewContainers: host.querySelectorAll(".split-view-container").length,
    splitViewViews: host.querySelectorAll(".split-view-view").length,
    partElementIsSplitViewView: !!host
      .querySelector(".part")
      ?.classList.contains("split-view-view"),
    leaf: leaf ? describe(leaf) : null,
    ancestors,
  };
}, view);

console.log(JSON.stringify(chain, null, 2));
await browser.close();
