/**
 * Verification of frame persistence in the rail UI.
 *
 * The old gate assumed a visible bottom region and a container bar. The current
 * rail has left / center and the Explorer stack; this gate still verifies the
 * important contract: the resized left track and a folded stack entry survive a
 * real reload, and the persisted key exists.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:persistence
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const STATE_KEY = "prac-layout/v1";
const LEFT = "left";
const VIEW = "vscode:view:outline";
const WIDTH = 340;
const url = requireUrl();
const { page, close } = await openPrac(url);

async function settle() {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__pracFrame, null, { timeout: 60_000 });
  await page.waitForTimeout(1200);
}

const sample = () =>
  page.evaluate(
    ({ key, left, view }) => {
      const region = document.querySelector(`[data-prac-region="${left}"]`);
      const row = document.querySelector(`[data-prac-stack-entry="${view}"]`);
      return {
        leftWidth: region ? Math.round(region.getBoundingClientRect().width) : null,
        row: row
          ? {
              collapsed: row.getAttribute("data-prac-stack-collapsed") === "true",
              height: Math.round(row.getBoundingClientRect().height),
            }
          : null,
        hasKey: localStorage.getItem(key) !== null,
      };
    },
    { key: STATE_KEY, left: LEFT, view: VIEW },
  );

await page.evaluate((key) => localStorage.removeItem(key), STATE_KEY);
await page.reload({ waitUntil: "load" });
await settle();
const initial = await sample();

await page.evaluate(
  ({ left, view, width }) => {
    const layout = globalThis.__pracFrame;
    layout.setWidth(left, width);
    layout.setViewCollapsed(view, true);
  },
  { left: LEFT, view: VIEW, width: WIDTH },
);
await page.waitForTimeout(1200);
const changed = await sample();

await page.reload({ waitUntil: "load" });
await settle();
const reloaded = await sample();

await close();

report({
  url,
  facts: { initial, changed, reloaded },
  checks: {
    "the persisted key exists": changed.hasKey,
    "the resize survives a reload":
      Math.abs((reloaded.leftWidth ?? 0) - (initial.leftWidth ?? 0)) >= 20,
    "the folded outline: its row comes back": reloaded.row !== null,
    "the folded state survives": reloaded.row?.collapsed === true,
    "the folded row keeps only its header": (reloaded.row?.height ?? 99) <= 30,
  },
  ok: "OK: a resized track and a folded stack entry persist across reload",
});
