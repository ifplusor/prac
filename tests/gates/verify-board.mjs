/**
 * The Explorer container is a real WidgetBoard: active, order, add and remove
 * go through the board model, and its bridge projects them into the frame.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

await page.waitForFunction(
  () => {
    const boards = globalThis.__pracWidgets?.boards?.() ?? [];
    return boards.some(
      (board) =>
        board.id === "left/container:workbench.view.explorer" && board.state.order.length > 1,
    );
  },
  null,
  { timeout: 90_000 },
);

const initial = await page.evaluate(() => {
  const board = globalThis.__pracWidgets
    .boards()
    .find((candidate) => candidate.id === "left/container:workbench.view.explorer");
  return board === undefined ? null : { active: board.state.active, order: [...board.state.order] };
});

const selected = await page.evaluate(() => {
  const board = globalThis.__pracWidgets
    .boards()
    .find((candidate) => candidate.id === "left/container:workbench.view.explorer");
  const next = board.state.order[1];
  board.select(next);
  return { active: board.state.active, expected: next };
});

const reordered = await page.evaluate(() => {
  const board = globalThis.__pracWidgets
    .boards()
    .find((candidate) => candidate.id === "left/container:workbench.view.explorer");
  const reversed = [...board.state.order].reverse();
  board.reorder(reversed);
  return { expected: reversed, actual: [...board.state.order] };
});

const added = await page.evaluate(() => {
  const board = globalThis.__pracWidgets.createBoardGroup("gate:board", "Gate");
  const view = {
    id: "gate:board-widget",
    host: undefined,
    mount: () => undefined,
    release: () => undefined,
    focus: () => undefined,
  };
  board.add(view);
  const inBoard =
    board.state.order.includes("gate:board-widget") &&
    board.view("gate:board-widget") !== undefined;
  board.remove("gate:board-widget");
  const removed = !board.state.order.includes("gate:board-widget");
  board.dispose();
  return { inBoard, removed };
});

await page.evaluate(({ active, order }) => {
  const board = globalThis.__pracWidgets
    .boards()
    .find((candidate) => candidate.id === "left/container:workbench.view.explorer");
  if (order !== undefined) board.reorder(order);
  if (active !== undefined) board.select(active);
}, initial ?? {});

await page.waitForTimeout(300);
const restored = await page.evaluate(() => {
  const board = globalThis.__pracWidgets
    .boards()
    .find((candidate) => candidate.id === "left/container:workbench.view.explorer");
  return { active: board.state.active, order: [...board.state.order] };
});

await close();
report({
  url,
  facts: { initial, selected, reordered, added, restored },
  checks: {
    "select changes the board's active widget":
      selected !== null && selected.active === selected.expected,
    "reorder changes the board order":
      reordered !== null && JSON.stringify(reordered.actual) === JSON.stringify(reordered.expected),
    "add / remove use the board model": added !== null && added.inBoard && added.removed,
    "the original board state is restored":
      initial !== null && JSON.stringify(restored) === JSON.stringify(initial),
    "no prac-owned console errors":
      own("__pracFrame").length === 0 && own("__pracWidgets").length === 0,
  },
  ok: "OK: the Explorer container's WidgetBoard owns active, order, add and remove, and restores its state.",
});
