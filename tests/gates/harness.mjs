/**
 * The harness prac's own live-page gates share.
 *
 * These gates assert **prac's mechanism** (the frame, the catalogue, placement,
 * persistence), so they live with prac and take only what a page needs: a live
 * DSH URL, chromium, and a way to look at pixels. They deliberately do not
 * borrow the upstream checkout's toolchain — a gate about prac must not depend
 * on `vscode:build` having run.
 *
 * The gates that *do* need the VS Code side (part hosts, the embed face,
 * extensions, the editor's pixels) stay in `vendor/vscode/scripts/`.
 *
 * @module prac/tests/gates/harness
 */
import { chromium } from "@playwright/test";

/**
 * The live DSH page to drive, from `URL` (token included), as every gate takes it.
 *
 * @param {string} [example] - a sample URL for the error message.
 * @returns {string} the URL.
 */
export function requireUrl(example = "http://127.0.0.1:3084/?token=…") {
  const url = process.env.URL;
  if (!url) throw new Error(`URL is required, e.g. URL="${example}"`);
  return url;
}

/**
 * Open the prac page: chromium, console capture, and the frame waited for.
 *
 * @param {string} url - the page URL.
 * @param {{ viewport?: { width: number, height: number } }} [options] - viewport.
 * @returns {Promise<{ browser: unknown, page: any, consoleErrors: string[], own: (prefix: string) => string[], close: () => Promise<void> }>}
 *   the page, the console lines, and `own(prefix)` to filter them to one
 *   feature's log prefix (the page carries known noise: missing native bindings
 *   and two optional client modules, so matching on "prac" would match every
 *   path in the workspace).
 */
export async function openPrac(url, options = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: options.viewport ?? { width: 1600, height: 1000 },
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__pracLayout, null, { timeout: 60_000 });
  return {
    browser,
    page,
    consoleErrors,
    own: (prefix) => consoleErrors.filter((line) => line.includes(prefix)),
    close: () => browser.close(),
  };
}

/**
 * Decode a PNG inside the page and count its distinct colours.
 *
 * Passed as a real function: Playwright serializes the function source, whereas
 * a string that evaluates to a function comes back as `undefined` and would
 * silently report "no paint".
 *
 * @param {string} base64 - the PNG bytes.
 * @returns {Promise<number>} the number of distinct colours.
 */
const countColours = async (base64) => {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const counts = new Set();
  for (let i = 0; i < data.length; i += 4) {
    counts.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return counts.size;
};

/**
 * How many distinct colours a clip has. One colour means "structurally present,
 * visually blank" — the failure mode that looks healthy in the DOM.
 *
 * @param {any} page - the Playwright page.
 * @param {{ x: number, y: number, w: number, h: number }} box - the clip.
 * @returns {Promise<number>} the number of distinct colours (0 when the box is degenerate).
 */
export async function distinctColours(page, box) {
  if (!box || box.w <= 2 || box.h <= 2) return 0;
  const shot = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
  });
  return page.evaluate(countColours, shot.toString("base64"));
}

/**
 * Read one element's box, the way every gate does.
 *
 * @param {string} selector - the element to measure.
 * @returns {Promise<{ x: number, y: number, w: number, h: number } | null>} the box.
 */
export async function boxOf(page, selector) {
  return page.evaluate((query) => {
    const element = document.querySelector(query);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }, selector);
}

/**
 * Report a gate's result the way every gate does: the facts as JSON, then one
 * `OK:` line or a `FAILED:` line and a non-zero exit.
 *
 * @param {{ url: string, facts: object, checks: Record<string, boolean>, ok: string }} result - the result.
 */
export function report(result) {
  console.log(JSON.stringify({ url: result.url, ...result.facts, checks: result.checks }, null, 2));
  const failed = Object.entries(result.checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log(result.ok);
}
