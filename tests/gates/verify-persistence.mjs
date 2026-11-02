/**
 * Verification of layout persistence in the rail UI.
 *
 * The important contract: a resized **frame** track and a folded **board** row
 * survive a real reload, and both persisted keys exist. The frame keeps the
 * region geometry; a container's board keeps its widget order / heights / folds
 * (the board is a window content now, so the fold lives in the board's own
 * state rather than in the frame's view table).
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:persistence
 */
import { clearLayoutState, openPrac, report, requireUrl } from "./harness.mjs";

const LEFT = "left";
const BOARD = "left/container:workbench.view.explorer";
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
    ({ left, view, boardId }) => {
      const region = document.querySelector(`[data-prac-region="${left}"]`);
      // The board's rows are inside the window's isolation root.
      const rows = [];
      const walk = (root) => {
        rows.push(...root.querySelectorAll(`[data-prac-stack-entry]`));
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) walk(element.shadowRoot);
        }
      };
      walk(document);
      const row = rows.find(
        (candidate) => candidate.getAttribute("data-prac-stack-entry") === view,
      );
      const board = globalThis.__pracWidgets?.boards?.().find((candidate) => candidate.id === boardId);
      const tree = board?.boardState?.tree;
      return {
        leftWidth: region ? Math.round(region.getBoundingClientRect().width) : null,
        row: row
          ? {
              collapsed: row.getAttribute("data-prac-stack-collapsed") === "true",
              height: Math.round(row.getBoundingClientRect().height),
            }
          : null,
        boardCollapsed:
          tree?.type === "split" && Array.isArray(tree.children)
            ? tree.children.find((child) => child.id === `${boardId}/board/stack/${view}`)
                ?.collapsed === true
            : undefined,
        hasFrameKey: Object.keys(localStorage).some(
          (key) =>
            key === "prac-frame/v1" ||
            key.startsWith("prac-frame/v1/") ||
            key === "prac-space/v1" ||
            key.startsWith("prac-space/v1/"),
        ),
        hasBoardKey: Object.keys(localStorage).some((key) => key.startsWith("prac-board/v1/")),
      };
    },
    { left: LEFT, view: VIEW, boardId: BOARD },
  );

await clearLayoutState(page);
await page.reload({ waitUntil: "load" });
await settle();
const initial = await sample();

await page.evaluate(
  ({ left, view, width, boardId }) => {
    globalThis.__pracFrame.setWidth(left, width);
    const board = globalThis.__pracWidgets.boards().find((candidate) => candidate.id === boardId);
    board.content.setWidgetCollapsed(view, true);
  },
  { left: LEFT, view: VIEW, width: WIDTH, boardId: BOARD },
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
    "the persisted keys exist": changed.hasFrameKey && changed.hasBoardKey,
    "the resize survives a reload":
      Math.abs((reloaded.leftWidth ?? 0) - (initial.leftWidth ?? 0)) >= 20,
    "the folded outline: its row comes back": reloaded.row !== null,
    "the folded state survives":
      reloaded.row?.collapsed === true && reloaded.boardCollapsed === true,
    "the folded row keeps only its header": (reloaded.row?.height ?? 99) <= 30,
  },
  ok: "OK: a resized track and a folded board row persist across reload",
});
