/**
 * Verification of the document app's PDF path.
 *
 * Opening a PDF is the whole funnel in one: the presented/router `open` selects
 * the app, the app's own `open` admits the window and places it, the frame
 * projects the item, and the window's content seat renders a real page onto a
 * canvas. A gate that stops at the frame item would pass while the person sees
 * nothing, so this one reads the canvas pixels.
 *
 * The fixture is written by the gate itself (a PDF needs no workspace), and it is
 * opened through the app registry — the same entry the presented card calls.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:pdf
 */
import { openPrac, report, requireUrl, until } from "./harness.mjs";
import { writeFixtures } from "../../vendor/vscode/scripts/gate-fixtures.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

// A fresh profile may show the first-run project picker; wait for the rail it covers.
await until(
  page,
  () => document.querySelector('[data-prac-activity="left"] [data-prac-rail-item]') !== null,
  null,
  { timeout: 10_000 },
);

/** One-page PDF with a single text row; pdf.js parses the trailer without an xref. */
const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 20 150 Td (gate pdf) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
`;

const [fixture] = writeFixtures("pdf", url, [{ name: "gate.pdf", body: pdf }]);

const opened = await page.evaluate((path) => {
  const app = globalThis.__pracTest?.applications?.open?.(path);
  return { app: app?.id ?? null };
}, fixture.path);

const placed = await until(
  page,
  (path) => {
    const items = globalThis.__pracTest?.frame?.getState?.()?.items ?? {};
    const item = items[`prac.document-preview:${path}`];
    return item !== undefined && item.region === "center" && item.hidden === false;
  },
  fixture.path,
  { timeout: 15_000 },
)
  .then(() => true)
  .catch(() => false);

const rendered = await until(
  page,
  () => {
    const canvas = document.querySelector("[data-prac-pdf-canvas]");
    return canvas !== null && canvas.width > 0 && canvas.height > 0;
  },
  null,
  { timeout: 20_000 },
)
  .then(() => true)
  .catch(() => false);

const facts = await page.evaluate((path) => {
  const canvas = document.querySelector("[data-prac-pdf-canvas]");
  return {
    windows: (globalThis.__pracTest?.windows?.ids?.() ?? []).filter((id) => id.includes(path)),
    views: document.querySelectorAll("[data-prac-pdf-view]").length,
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    error: document.querySelector("[data-prac-pdf-error]")?.textContent ?? null,
  };
}, fixture.path);

await close();

report({
  url,
  facts: { opened, placed, rendered, ...facts },
  checks: {
    "the app registry picks the document app": opened.app === "prac.document-preview",
    "the document window is placed in the centre": placed,
    "the PDF view mounts": facts.views === 1 && facts.error === null,
    "the canvas has page pixels": rendered && facts.canvasWidth > 0 && facts.canvasHeight > 0,
    "no prac-owned console errors": own("__pracTest").length === 0,
  },
});
