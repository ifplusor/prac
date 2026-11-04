/**
 * The Explorer container is a board **window**: its widget order, active widget,
 * add and remove go through the board content, the frame projects one window
 * record whose `boardId` points at that content, and the rows it renders follow
 * the board's own state.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";
import { writeFixtures } from "../../vendor/vscode/scripts/gate-fixtures.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

const BOARD = "left/container:workbench.view.explorer";

await page.waitForFunction(
  (boardId) => {
    const boards = globalThis.__pracTest?.widgets?.boards?.() ?? [];
    return boards.some((board) =>
      board.id === boardId && typeof board.widgetOrder === "function"
        ? board.widgetOrder().length > 1
        : false,
    );
  },
  BOARD,
  { timeout: 90_000 },
);

const read = () =>
  page.evaluate((boardId) => {
    const board = globalThis.__pracTest?.widgets?.boards().find((candidate) => candidate.id === boardId);
    const host = document.querySelector(`[data-prac-view-id="${boardId}/board"]`);
    const root = host?.shadowRoot;
    return {
      window: board === undefined ? null : board.state.active,
      record: globalThis.__pracTest?.frame.getState().items[`${boardId}/board`] ?? null,
      order: board === undefined ? [] : [...board.widgetOrder()],
      active: board === undefined ? undefined : board.content.activeWidget,
      rows:
        root === undefined || root === null
          ? []
          : [...root.querySelectorAll("[data-prac-stack-entry]")].map((row) =>
              row.getAttribute("data-prac-stack-entry"),
            ),
    };
  }, BOARD);

const initial = await read();

const selected = await page.evaluate((boardId) => {
  const board = globalThis.__pracTest?.widgets?.boards().find((candidate) => candidate.id === boardId);
  const next = board.widgetOrder()[1];
  board.selectWidget(next);
  return { expected: next, active: board.content.activeWidget };
}, BOARD);

await page.waitForTimeout(300);
const afterSelect = await read();

const reordered = await page.evaluate((boardId) => {
  const board = globalThis.__pracTest?.widgets?.boards().find((candidate) => candidate.id === boardId);
  const reversed = [...board.widgetOrder()].reverse();
  board.reorderWidgets(reversed);
  return { expected: reversed, actual: [...board.widgetOrder()] };
}, BOARD);

await page.waitForTimeout(300);
const afterReorder = await read();

const added = await page.evaluate(() => {
  const board = globalThis.__pracTest?.widgets?.createBoardWindow("gate:board", "Gate");
  board.addWidget("gate:board-widget");
  const inBoard = board.widgetOrder().includes("gate:board-widget");
  board.removeWidget("gate:board-widget");
  const removed = !board.widgetOrder().includes("gate:board-widget");
  board.dispose();
  return { inBoard, removed };
});

// A widget drag from a board tab / row header carries `application/x-prac-widget`;
// dropping it on another board region moves it (center) or splits the target board
// (edge). This is the UI path, not the service call.
const dragBoard = await page.evaluate(async () => {
  const board = globalThis.__pracTest?.widgets?.createBoardWindow("gate:drag-board", "Drag");
  board.addWidget("gate:drag-a");
  board.addWidget("gate:drag-b");
  globalThis.__pracTest?.frame.place(board.windowId, "center");
  globalThis.__pracTest?.frame.setItemBoard(board.windowId, board.boardId);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const host = document.querySelector(`[data-prac-view-id="${board.windowId}"]`);
  const root = host?.shadowRoot;
  const zones =
    root === null || root === undefined
      ? []
      : [...root.querySelectorAll("[data-prac-widget-drop]")];
  const before = board.content.get().items["gate:drag-b"]?.region ?? null;
  const beforeOrder = board.content.get().items["gate:drag-b"]?.order ?? null;
  const target = zones.find((zone) => zone.getAttribute("data-prac-widget-drop") !== before);
  const targetRegion = target?.getAttribute("data-prac-widget-drop") ?? null;
  let after = before;
  let dragPrevented = null;
  if (target !== null && target !== undefined) {
    const rect = target.getBoundingClientRect();
    const data = new DataTransfer();
    data.setData(
      "application/x-prac-widget",
      JSON.stringify({ boardId: board.boardId, widgetId: "gate:drag-b" }),
    );
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const over = new DragEvent("dragover", init);
    Object.defineProperty(over, "dataTransfer", { value: data });
    const drop = new DragEvent("drop", init);
    Object.defineProperty(drop, "dataTransfer", { value: data });
    target.dispatchEvent(over);
    target.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 300));
    dragPrevented = { over: over.defaultPrevented, drop: drop.defaultPrevented };
    after = board.content.get().items["gate:drag-b"]?.region ?? null;
  }
  const result = {
    zones: zones.length,
    before,
    targetRegion,
    after,
    beforeOrder,
    afterOrder: board.content.get().items["gate:drag-b"]?.order ?? null,
    hasWidget: board.hasWidget("gate:drag-b"),
    prevented: dragPrevented,
  };
  globalThis.__pracTest?.frame.removeItem(board.windowId);
  board.dispose();
  return result;
});

// Cross-board UI drop: a widget from a temporary stage board is dropped on the
// Explorer board's region; the service moves it, the source loses it.
const crossDrag = await page.evaluate(async (targetBoardId) => {
  const source = globalThis.__pracTest?.widgets?.createBoardWindow("gate:drag-cross", "Cross");
  source.addWidget("gate:cross-a");
  globalThis.__pracTest?.frame.place(source.windowId, "center");
  globalThis.__pracTest?.frame.setItemBoard(source.windowId, source.boardId);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const target = globalThis.__pracTest?.widgets?.boards().find((board) => board.id === targetBoardId);
  const host =
    target === undefined
      ? null
      : document.querySelector(`[data-prac-view-id="${target.windowId}"]`);
  const targetRoot = host?.shadowRoot;
  const zone = targetRoot?.querySelector("[data-prac-widget-drop]") ?? null;
  let targetHas = false;
  let sourceHas = true;
  if (target !== undefined && zone !== null) {
    const rect = zone.getBoundingClientRect();
    const data = new DataTransfer();
    data.setData(
      "application/x-prac-widget",
      JSON.stringify({ boardId: source.boardId, widgetId: "gate:cross-a" }),
    );
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: data,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    const over = new DragEvent("dragover", init);
    Object.defineProperty(over, "dataTransfer", { value: data });
    const drop = new DragEvent("drop", init);
    Object.defineProperty(drop, "dataTransfer", { value: data });
    zone.dispatchEvent(over);
    zone.dispatchEvent(drop);
    await new Promise((resolve) => setTimeout(resolve, 400));
    targetHas = target.hasWidget("gate:cross-a");
    sourceHas = source.hasWidget("gate:cross-a");
    target.removeWidget("gate:cross-a");
  }
  globalThis.__pracTest?.frame.removeItem(source.windowId);
  source.dispose();
  return { targetHas, sourceHas };
}, BOARD);

// Cross-board is move-only; an optional split is completed inside the **target** board root.
const moved = await page.evaluate(() => {
  const a = globalThis.__pracTest?.widgets?.createBoardWindow("gate:move-a", "A");
  const b = globalThis.__pracTest?.widgets?.createBoardWindow("gate:move-b", "B");
  a.addWidget("gate:w1");
  b.addWidget("gate:w2");
  const ok = globalThis.__pracTest?.widgets?.moveWidget("gate:w1", "gate:move-a", "gate:move-b", {
    split: "right",
  });
  const record = b.boardState.items["gate:w1"];
  const result = {
    ok,
    sourceHas: a.hasWidget("gate:w1"),
    targetHas: b.hasWidget("gate:w1"),
    contentId: record?.contentId ?? null,
    region: record?.region ?? null,
    otherRegion: b.boardState.items["gate:w2"]?.region ?? null,
    treeType: b.boardState.tree.type,
    sourceRoot: a.boardState.tree.id,
    targetRoot: b.boardState.tree.id,
  };
  a.dispose();
  b.dispose();
  return result;
});

// A board window on the stage gets a `PracWindowInput` identity projection (the frame
// renders the board; the app only needs to know the window exists). The centre needs an
// editor group, which opening a file creates.
const [stageFixture] = writeFixtures("board-stage", url, [
  { name: "stage.md", body: (token) => `# stage ${token}\n` },
]);
const stage = await page.evaluate(
  async ({ uri }) => {
    await globalThis.__vscodeEmbed.face.openFile(uri);
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const fileId = Object.keys(globalThis.__pracTest?.frame.getState().items).find((id) =>
        id.startsWith("vscode:file:"),
      );
      if (fileId !== undefined) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const board = globalThis.__pracTest?.widgets?.createBoardWindow("gate:stage-board", "Gate Stage");
    globalThis.__pracTest?.frame.place(board.windowId, "center");
    globalThis.__pracTest?.frame.setItemBoard(board.windowId, board.boardId);
    await new Promise((resolve) => setTimeout(resolve, 600));
    globalThis.__pracVscodeFace.mapWindow(board.windowId, "Gate Stage", "center");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const result = {
      mapped: globalThis.__pracVscodeFace.mappedWindows().includes(board.windowId),
      record: globalThis.__pracTest?.frame.getState().items[board.windowId] ?? null,
    };
    globalThis.__pracVscodeFace.unmapWindow(board.windowId);
    globalThis.__pracTest?.frame.removeItem(board.windowId);
    board.dispose();
    return result;
  },
  { uri: stageFixture.uri },
);

await page.evaluate(
  ({ boardId, order, active }) => {
    const board = globalThis.__pracTest?.widgets?.boards().find((candidate) => candidate.id === boardId);
    board.reorderWidgets(order);
    if (active !== undefined) board.selectWidget(active);
  },
  { boardId: BOARD, order: initial.order, active: initial.active },
);

await page.waitForTimeout(300);
const restored = await read();

await close();

report({
  url,
  facts: {
    initial,
    selected,
    afterSelect,
    reordered,
    afterReorder,
    added,
    dragBoard,
    crossDrag,
    moved,
    stage,
    restored,
  },
  checks: {
    "the board is a window content with a boardId":
      initial.record !== null && initial.record.boardId === `${BOARD}/board`,
    "the board's rows follow its widget order":
      initial.order.length > 1 &&
      initial.rows.length === initial.order.length &&
      initial.rows.every((id, index) => id === initial.order[index]),
    "select changes the board's active widget":
      selected.active === selected.expected && afterSelect.active === selected.expected,
    "reorder changes the board order and the rendered rows":
      JSON.stringify(afterReorder.order) === JSON.stringify(reordered.expected) &&
      JSON.stringify(afterReorder.rows) === JSON.stringify(reordered.expected),
    "add / remove use the board content": added.inBoard && added.removed,
    "widget drag/drop moves a widget between board regions":
      dragBoard.zones >= 2 &&
      dragBoard.hasWidget &&
      dragBoard.targetRegion !== null &&
      dragBoard.afterOrder !== dragBoard.beforeOrder &&
      dragBoard.prevented?.over === true &&
      dragBoard.prevented?.drop === true,
    "cross-board widget drag moves the widget into the target board":
      crossDrag.targetHas && !crossDrag.sourceHas,
    "a cross-board move is move-only and splits inside the target board":
      moved.ok &&
      !moved.sourceHas &&
      moved.targetHas &&
      moved.contentId === "gate:w1" &&
      moved.region !== moved.otherRegion &&
      moved.treeType === "split",
    "a stage board window has a PracWindowInput identity projection":
      stage.mapped && stage.record?.boardId === "gate:stage-board/board",
    "the original board state is restored":
      JSON.stringify(restored.order) === JSON.stringify(initial.order) &&
      restored.active === initial.active,
    "no prac-owned console errors":
      own("__pracTest").length === 0 && own("__pracTest").length === 0,
  },
  ok: "OK: the Explorer board window owns widget order / active / add / remove and renders them",
});
