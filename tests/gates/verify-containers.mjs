/**
 * Verification of the current dock rail.
 *
 * The workbench replaced the old container bar with a `prac-activity` rail. This
 * gate asserts the rail's contract: the left rail lists the borrowed container
 * tools, exactly one is active, clicking one selects it, and the selected
 * container's views mount with real height. It also checks that the Explorer
 * stack still has its tree / outline / timeline rows.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:containers
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

// A fresh profile may show the first-run project picker; the rail is behind it.
await page.waitForTimeout(2500);

const read = () =>
  page.evaluate(() => {
    const rail = (side) => {
      const nav = document.querySelector(`[data-prac-activity="${side}"]`);
      return {
        side,
        items: [...(nav?.querySelectorAll("[data-prac-rail-item]") ?? [])].map((item) => ({
          id: item.getAttribute("data-prac-rail-item"),
          active: item.classList.contains("active"),
          label: (item.textContent ?? "").trim(),
        })),
      };
    };
    return {
      left: rail("left"),
      right: rail("right"),
      views: globalThis.__pracFrame?.listViews().map((view) => ({
        id: view.id,
        region: view.region ?? null,
        hidden: view.hidden === true,
      })),
      stack: [...document.querySelectorAll("[data-prac-stack-entry]")].map((entry) => ({
        id: entry.getAttribute("data-prac-stack-entry"),
        height: Math.round(entry.getBoundingClientRect().height),
      })),
      surfaces: [...document.querySelectorAll("[data-prac-surface]")].map((element) => ({
        region: element.getAttribute("data-prac-region"),
        kind: element.getAttribute("data-prac-surface"),
      })),
    };
  });

const initial = await read();
const leftIds = initial.left.items.map((item) => item.id);
const activeLeft = initial.left.items.filter((item) => item.active);

await page.click('[data-prac-activity="left"] [data-prac-rail-item="workbench.view.search"]');
await page.waitForTimeout(1200);
const search = await read();

await page.click('[data-prac-activity="left"] [data-prac-rail-item="workbench.view.explorer"]');
await page.waitForTimeout(1200);
const explorer = await read();

await close();

report({
  url,
  facts: { initial, search, explorer },
  checks: {
    "the left rail lists the borrowed containers": [
      "workbench.view.explorer",
      "workbench.view.search",
      "workbench.view.scm",
      "workbench.view.debug",
      "workbench.view.extension.gitlens",
    ].every((id) => leftIds.includes(id)),
    "the right rail lists the agent": initial.right.items.some((item) => item.id === "chat"),
    "each rail has at most one active item":
      initial.left.items.filter((item) => item.active).length <= 1,
    "the left rail starts on Explorer": activeLeft[0]?.id === "workbench.view.explorer",
    "clicking Search selects the Search tool":
      search.left.items.find((item) => item.id === "workbench.view.search")?.active === true,
    "Search has a placed, visible view": search.views.some(
      (view) =>
        view.id === "vscode:view:workbench.view.search" && view.region !== null && !view.hidden,
    ),
    "clicking Explorer selects Explorer again":
      explorer.left.items.find((item) => item.id === "workbench.view.explorer")?.active === true,
    "Explorer has the file tree / outline / timeline rows": [
      "vscode:view:workbench.explorer.fileView",
      "vscode:view:outline",
      "vscode:view:timeline",
    ].every((id) => explorer.stack.some((row) => row.id === id && row.height > 0)),
    "the borrowed surfaces are registered": [
      "vscode:view:workbench.explorer.fileView",
      "vscode:view:workbench.view.search",
      "vscode:view:workbench.scm",
    ].every((id) => initial.views.some((view) => view.id === id)),
    "no prac-owned console errors":
      own("__pracFrame").length === 0 && own("vscode-embed:").length === 0,
  },
  ok: "OK: the dock rail lists the borrowed containers, switches tools, and mounts their views",
});
