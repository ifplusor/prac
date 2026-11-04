/**
 * Verification of a real frame split in the rail UI.
 *
 * The old gate assumed a `root:1` split and a container-bar layout. The current
 * rail keeps `left` / `center` as a row split (`top:1`); this gate drags that
 * sash and asserts the two sides change width while the row stays intact.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:split
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

await page.waitForTimeout(2500);

const box = (selector) =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }, selector);

const left = await box('[data-prac-region="left"]');
const center = await box('[data-prac-region="center"]');
const sash = await box('[data-prac-sash="top:1"]');

const point = sash
  ? { x: Math.round(sash.x + sash.w / 2), y: Math.round(sash.y + sash.h / 2) }
  : null;
if (point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 60, point.y);
  await page.mouse.up();
}
await page.waitForTimeout(700);

const leftAfter = await box('[data-prac-region="left"]');
const centerAfter = await box('[data-prac-region="center"]');

await close();

report({
  url,
  facts: { left, center, sash, leftAfter, centerAfter },
  checks: {
    "the row split has a left and a center region": left !== null && center !== null,
    "the split has a sash": sash !== null,
    "dragging the sash changes both widths":
      (leftAfter?.w ?? 0) !== (left?.w ?? 0) && (centerAfter?.w ?? 0) !== (center?.w ?? 0),
    "the two sides trade roughly the drag distance":
      Math.abs(Math.abs((leftAfter?.w ?? 0) - (left?.w ?? 0)) - 60) <= 12,
    "the row keeps the same height":
      (leftAfter?.h ?? 0) === (left?.h ?? 0) && (centerAfter?.h ?? 0) === (center?.h ?? 0),
    "no prac-owned console errors":
      own("__pracTest").length === 0 && own("prac-client-ui-frame").length === 0,
  },
  ok: "OK: dragging the row sash resizes both sides without changing the row height",
});
