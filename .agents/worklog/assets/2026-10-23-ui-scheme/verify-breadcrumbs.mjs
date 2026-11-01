import { createRequire } from "node:module";
import { installDeepDom, waitDeep } from "../../../../vendor/vscode/scripts/deep-dom.mjs";
import { writeFixtures } from "../../../../vendor/vscode/scripts/gate-fixtures.mjs";
const require = createRequire("/Volumes/Dev/prac/prac-dev/.build/vscode/package.json");
const { chromium } = require("@playwright/test");
const url = process.env.URL;
const [MD, TXT] = writeFixtures("breadcrumbs", url, [
  { name: "note.md", body: "# Title\n\nSome **markdown** text.\n" },
  { name: "note.txt", body: "plain text\n" },
]);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(url, { waitUntil: "load" });
await installDeepDom(page);
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 90_000 });
if (await page.$("[data-prac-firstrun]")) {
  await page.locator("[data-prac-firstrun] button", { hasText: "prac-dev" }).first().click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(2500);
}
const hidePicker = () => page.evaluate(() => {
  if (document.querySelector("[data-test-hide-picker]")) return;
  const style = document.createElement("style");
  style.dataset.testHidePicker = "";
  style.textContent = process.env.PICKER_CSS || ".breadcrumbs-editor-type{display:none!important}";
  document.head.append(style);
});
if (process.env.HIDE_EARLY) {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = process.env.PICKER_CSS || ".breadcrumbs-editor-type{display:none!important}";
    document.head.append(style);
  });
}
const inspect = () => page.evaluate(() => {
  const deep = globalThis.__deep;
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const crumbs = deep.all(".monaco-breadcrumbs");
  const titles = deep.all(".prac-editor-title");
  const groups = deep.all(".prac-editor-group");
  const editors = deep.all(".monaco-editor");
  const actions = deep.all(".prac-editor-actions");
  const pickers = deep.all(".breadcrumbs-editor-type");
  const topAt = (x, y) => document.elementsFromPoint(x, y).slice(0, 5).map(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: String(el.className).slice(0, 60),
      id: el.id,
      parent: String(el.parentElement?.className ?? "").slice(0, 60),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      z: cs.zIndex,
      bg: cs.backgroundColor,
      pe: cs.pointerEvents,
    };
  });
  return {
    groups: groups.length,
    titles: titles.map(el => ({ ...box(el), display: getComputedStyle(el).display, height: getComputedStyle(el).height })),
    crumbs: crumbs.map(el => ({
      ...box(el),
      display: getComputedStyle(el).display,
      visibility: getComputedStyle(el).visibility,
      height: getComputedStyle(el).height,
      items: el.querySelectorAll(".monaco-breadcrumb-item").length,
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
      style: el.getAttribute("style"),
      parent: el.parentElement ? `${el.parentElement.className} ${JSON.stringify((() => { const r = el.parentElement.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })())}` : null,
      html: el.outerHTML.slice(0, 240),
      itemInfo: [...el.querySelectorAll(".monaco-breadcrumb-item")].map(item => ({
        text: (item.textContent ?? "").trim(),
        color: getComputedStyle(item).color,
        display: getComputedStyle(item).display,
        opacity: getComputedStyle(item).opacity,
        w: Math.round(item.getBoundingClientRect().width),
        h: Math.round(item.getBoundingClientRect().height),
        x: Math.round(item.getBoundingClientRect().x),
        y: Math.round(item.getBoundingClientRect().y),
        html: item.innerHTML.slice(0, 260),
        label: (() => {
          const a = item.querySelector(".label-name");
          if (!a) return null;
          const cs = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          return { color: cs.color, fill: cs.webkitTextFillColor, fontSize: cs.fontSize, opacity: cs.opacity, visibility: cs.visibility, display: cs.display, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
        chain: (() => {
          const out = [];
          let node = item;
          for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
            const cs = getComputedStyle(node);
            out.push({ cls: String(node.className).slice(0, 40), opacity: cs.opacity, visibility: cs.visibility, display: cs.display, filter: cs.filter, clip: cs.clipPath, transform: cs.transform, color: cs.color, fontSize: cs.fontSize, bg: cs.backgroundColor });
          }
          return out;
        })(),
      })),
    })),
    editors: editors.map(box),
    actions: actions.map(el => ({ ...box(el), offset: el.offsetWidth, children: el.children.length })),
    stackAtBreadcrumb: topAt(300, 68),
    stackAtFirstItem: topAt(300, 68),
    pickers: pickers.map(el => ({ ...box(el), offset: el.offsetWidth, display: getComputedStyle(el).display, width: getComputedStyle(el).width, text: (el.textContent ?? "").slice(0, 40) })),
    titleChildren: titles.flatMap(el => [...el.children].map(child => ({ cls: child.className, ...box(child) }))),
    active: globalThis.__vscodeEmbed?.face?.listPlacements?.().map(p => `${p.placement}@${p.region}`) ?? null,
  };
});
for (const file of (process.env.ORDER === "MD" ? [MD] : [TXT, MD, MD])) {
  await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), file.uri);
  await waitDeep(page, "[data-vscode-embed-file] .monaco-editor");
  await page.waitForTimeout(3500);
  console.log(file.name, JSON.stringify(await inspect(), null, 2));
  if (process.env.HIDE_PICKER) {
    await hidePicker();
    await page.setViewportSize({ width: 1601, height: 1000 });
    await page.waitForTimeout(1500);
    console.log(file.name + " after hide picker", JSON.stringify(await inspect(), null, 2));
  }
  if (process.env.RESIZE) {
    await page.setViewportSize({ width: 1601, height: 1000 });
    await page.waitForTimeout(1500);
    console.log(file.name + " after resize", JSON.stringify(await inspect(), null, 2));
  }
  await page.screenshot({ path: new URL(`./breadcrumbs-${file.name.replaceAll(".", "-")}.png`, import.meta.url).pathname });
}
await browser.close();
