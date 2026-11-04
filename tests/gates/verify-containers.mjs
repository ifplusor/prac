/**
 * Verification of the dock rail and the container boards.
 *
 * The workbench replaced the old container bar with a `prac-activity` rail. This
 * gate asserts the rail's contract: the left rail lists the borrowed container
 * tools, exactly one is active, clicking one selects it, and the selected
 * container's **board window** mounts with real height. It also checks that the
 * Explorer board still has its tree / outline / timeline rows.
 *
 * A container region's surface is a `WindowGroup` whose window content is the
 * board; the widget rows render inside that window's isolation root, so the DOM
 * reads below walk shadow roots.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:containers
 */
import { openPrac, report, requireUrl, until } from "./harness.mjs";
import { writeFixtures } from "../../vendor/vscode/scripts/gate-fixtures.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

// A fresh profile may show the first-run project picker; wait for the rail it covers.
await until(
  page,
  () => {
    const items = [...document.querySelectorAll('[data-prac-activity="left"] [data-prac-rail-item]')].map(
      (item) => item.getAttribute("data-prac-rail-item"),
    );
    return [
      "workbench.view.explorer",
      "workbench.view.search",
      "workbench.view.scm",
      "workbench.view.debug",
      "workbench.view.extension.gitlens",
    ].every((id) => items.includes(id));
  },
  null,
  { timeout: 10_000 },
);

const read = () =>
  page.evaluate(() => {
    const deepAll = (selector) => {
      const found = [...document.querySelectorAll(selector)];
      const walk = (root) => {
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) {
            found.push(...element.shadowRoot.querySelectorAll(selector));
            walk(element.shadowRoot);
          }
        }
      };
      walk(document);
      return found;
    };
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
      views: globalThis.__pracTest?.frame?.listItems().map((view) => ({
        id: view.id,
        region: view.region ?? null,
        hidden: view.hidden === true,
        kind: view.kind,
      })),
      stack: deepAll("[data-prac-stack-entry]").map((entry) => ({
        id: entry.getAttribute("data-prac-stack-entry"),
        height: Math.round(entry.getBoundingClientRect().height),
      })),
      widgetBoards: (globalThis.__pracWidgets?.boards?.() ?? []).map((board) => ({
        id: board.id,
        window: board.state.active,
        widgets: typeof board.widgetOrder === "function" ? [...board.widgetOrder()] : [],
      })),
      surfaces: [...document.querySelectorAll("[data-prac-region-content]")].map((element) => ({
        region: element.getAttribute("data-prac-region"),
        split: element.getAttribute("data-prac-split"),
        kind: element.getAttribute("data-prac-region-content"),
      })),
    };
  });

const initial = await read();
const leftIds = initial.left.items.map((item) => item.id);
const activeLeft = initial.left.items.filter((item) => item.active);

await page.click('[data-prac-activity="left"] [data-prac-rail-item="workbench.view.search"]');
await until(
  page,
  () =>
    document
      .querySelector('[data-prac-activity="left"] [data-prac-rail-item].active')
      ?.getAttribute("data-prac-rail-item") === "workbench.view.search",
  null,
  { timeout: 5000 },
);
const search = await read();

await page.click('[data-prac-activity="left"] [data-prac-rail-item="workbench.view.explorer"]');
await until(
  page,
  () =>
    document
      .querySelector('[data-prac-activity="left"] [data-prac-rail-item].active')
      ?.getAttribute("data-prac-rail-item") === "workbench.view.explorer",
  null,
  { timeout: 5000 },
);
const explorer = await read();

// A single editor window can live in the sidebar's WindowGroup: a file the frame
// places in a container region is a **window** of that group (the workbench owns its
// record; the group hosts it), and it renders there.
const [fixture] = writeFixtures("containers-editor", url, [
  { name: "sidebar-editor.md", body: (token) => `# sidebar ${token}\n\n${token}\n` },
]);
const openedFile = await page.evaluate(async (uri) => {
  await globalThis.__vscodeEmbed.face.openFile(uri);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const fileId = Object.keys(globalThis.__pracTest?.frame.getState().items).find((id) =>
      id.startsWith("vscode:file:"),
    );
    if (fileId !== undefined) return { fileId };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { fileId: null };
}, fixture.uri);
await page.waitForTimeout(1200);

await page.evaluate(
  ({ fileId, boardId }) => {
    if (fileId !== null) globalThis.__pracTest?.frame.place(fileId, boardId);
  },
  { fileId: openedFile.fileId, boardId: "left/container:workbench.view.explorer" },
);
await page.waitForTimeout(2500);

const sidebarWindow = await page.evaluate((boardId) => {
  const board = globalThis.__pracWidgets.boards().find((candidate) => candidate.id === boardId);
  const deep = (selector) => {
    const found = [...document.querySelectorAll(selector)];
    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) {
          found.push(...element.shadowRoot.querySelectorAll(selector));
          walk(element.shadowRoot);
        }
      }
    };
    walk(document);
    return found;
  };
  const editors = deep(".monaco-editor")
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 40 && box.height > 40 && box.left < 400 && box.top > 40);
  const fileIds = Object.keys(globalThis.__pracTest?.frame.getState().items).filter((id) =>
    id.startsWith("vscode:file:"),
  );
  return {
    hosted: typeof board?.hostedWindows === "object" ? [...board.hostedWindows] : [],
    fileIds,
    fileRegions: fileIds.map((id) => globalThis.__pracTest?.frame.getState().items[id]?.region ?? null),
    editorsInSidebar: editors.length,
  };
}, "left/container:workbench.view.explorer");

// The board window gets a `PracWindowInput` identity projection once its sidebar
// has an editor group (the frame still renders the board; the app only knows it exists).
const boardMapped = await page
  .waitForFunction(
    (boardId) => {
      const board = globalThis.__pracWidgets.boards().find((candidate) => candidate.id === boardId);
      return (
        board !== undefined && globalThis.__pracVscodeFace.mappedWindows().includes(board.windowId)
      );
    },
    "left/container:workbench.view.explorer",
    { timeout: 15_000 },
  )
  .then(() => true)
  .catch(() => false);

await close();

const board = (sample, id) => sample.widgetBoards.find((candidate) => candidate.id === id);
const owns = (sample, id, widget) => board(sample, id)?.widgets.includes(widget) === true;

report({
  url,
  facts: { initial, search, explorer, sidebarWindow, boardMapped },
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
    "Search's board owns its view": owns(
      search,
      "left/container:workbench.view.search",
      "vscode:view:workbench.view.search",
    ),
    "clicking Explorer selects Explorer again":
      explorer.left.items.find((item) => item.id === "workbench.view.explorer")?.active === true,
    "Explorer has the file tree / outline / timeline rows": [
      "vscode:view:workbench.explorer.fileView",
      "vscode:view:outline",
      "vscode:view:timeline",
    ].every((id) => explorer.stack.some((row) => row.id === id && row.height > 0)),
    "rail containers own WindowGroup surfaces":
      initial.surfaces.some((surface) => surface.kind === "window-group") &&
      explorer.surfaces.some((surface) => surface.kind === "window-group"),
    "the Explorer board window owns its widgets":
      owns(explorer, "left/container:workbench.view.explorer", "vscode:view:outline") &&
      owns(explorer, "left/container:workbench.view.explorer", "vscode:view:timeline"),
    "the borrowed views are board widgets":
      owns(
        initial,
        "left/container:workbench.view.explorer",
        "vscode:view:workbench.explorer.fileView",
      ) && owns(initial, "left/container:workbench.view.scm", "vscode:view:workbench.scm"),
    "the board window has a PracWindowInput identity projection": boardMapped,
    "a single editor window can live in the sidebar WindowGroup":
      sidebarWindow.hosted.some((id) => id.startsWith("vscode:file:")) &&
      sidebarWindow.fileRegions.some(
        (region) => typeof region === "string" && region.startsWith("left/container:"),
      ) &&
      sidebarWindow.editorsInSidebar > 0,
    "no prac-owned console errors":
      own("__pracTest").length === 0 && own("vscode-embed:").length === 0,
  },
  ok: "OK: the dock rail lists the borrowed containers, switches tools, and mounts their boards",
});
