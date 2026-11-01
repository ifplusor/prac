import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url = process.env.URL;
const host = new URL(url).host;
const files = [
  "/Volumes/Dev/prac/prac-dev/.agents/notes/in-progress/2026-10-23-ui-scheme.md",
  "/Volumes/Dev/prac/prac-dev/.agents/notes/in-progress/2026-10-27-ui-user-stories.md",
];
const uriOf = (p) => `vscode-remote://${host}${p}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url, { waitUntil: "load" }); await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
if (await page.$("[data-prac-firstrun]")) {
  await page.locator("[data-prac-firstrun] button", { hasText: "prac-dev" }).first().click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(2500);
}
for (const p of files) {
  await page.evaluate((u) => globalThis.__vscodeEmbed.face.openFile(u), uriOf(p));
  await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
  await page.waitForTimeout(3000);
}
const read = () => page.evaluate(() => globalThis.__deep.all(".monaco-breadcrumbs").map((el) => ({
  w: Math.round(el.getBoundingClientRect().width),
  style: el.getAttribute("style"),
  items: [...el.querySelectorAll(".monaco-breadcrumb-item")].map((i) => (i.textContent ?? "").trim()),
})));
if (process.env.PICKER_CSS) {
  await page.evaluate((css) => {
    const el = globalThis.__deep.all(".breadcrumbs-control")[0];
    const root = el?.getRootNode();
    const style = document.createElement("style");
    style.textContent = css;
    (root instanceof ShadowRoot ? root : document.head).append(style);
  }, process.env.PICKER_CSS);
}
await page.evaluate(() => { globalThis.__BC_LOG = []; });
console.log("START", JSON.stringify(await read()));
const tabs = await page.evaluate(() => [...document.querySelectorAll("[data-prac-tab]")].filter((el) => el.getAttribute("data-prac-tab")?.includes(".md")).map((el) => el.getAttribute("data-prac-tab")));
for (let i = 0; i < 12; i++) {
  const id = tabs[i % tabs.length];
  await page.click(`[data-prac-tab="${id}"]`);
  await page.waitForTimeout(2000);
  const state = await read();
  if (i === 0) await page.screenshot({ path: new URL("./md-real-switch.png", import.meta.url).pathname });
  console.log(i, id.includes("ui-scheme") ? "scheme" : "stories", JSON.stringify(state));
  if (state.some((crumb) => crumb.w === 0)) {
    console.log("PICKER", JSON.stringify(await page.evaluate(() => {
      const el = globalThis.__deep.all(".breadcrumbs-control")[0];
      const picker = el?.querySelector(".breadcrumbs-editor-type");
      const cs = picker ? getComputedStyle(picker) : null;
      const parent = el ? getComputedStyle(el) : null;
      return {
        picker: picker ? { rect: Math.round(picker.getBoundingClientRect().width), offset: picker.offsetWidth, display: cs.display, width: cs.width, maxWidth: cs.maxWidth, flex: cs.flex, position: cs.position, style: picker.getAttribute("style"), text: picker.textContent } : null,
        parent: parent ? { cls: el.className, display: parent.display, width: parent.width } : null,
        styleTags: [...(el?.getRootNode()?.querySelectorAll?.("style") ?? [])].map((s) => s.textContent?.includes("breadcrumbs-editor-type") ? s.textContent.slice(0, 200) : null).filter(Boolean),
      };
    }), null, 2));
    break;
  }
}
await browser.close();
