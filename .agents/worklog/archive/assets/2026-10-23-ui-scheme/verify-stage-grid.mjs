/**
 * Live check for the stage-grid fix: create/split/merge/unmerge/remove cells
 * and assert the grid stays tight (no placement for a removed cell, no empty
 * track, rows/columns equal the used extent).
 *
 * Run with URL="http://192.168.1.11:3084/?token=…" node .scratch/verify-stage-grid.mjs
 */
import { chromium } from "@playwright/test";

const url = process.env.URL;
if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=…"');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2500);

// A fresh browser context has no remembered project folder, so the first-run
// overlay covers the frame. Open the prac-dev recent row and let the workspace
// load before driving the layout.
if (await page.$("[data-prac-firstrun]")) {
  const row = page.locator("[data-prac-firstrun] button", { hasText: "prac-dev" }).first();
  await row.click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(3000);
}

const target = await page.evaluate(() => {
  const state = globalThis.__pracLayout.getState();
  const conversation = state.views["dsh:main:conversation"]?.region;
  const walk = (node, out) => {
    if (node.type === "grid") {
      const ids = node.children.map((child) => child.id);
      const nested = node.children.some((child) =>
        (child.children ?? []).some((grandchild) => grandchild.id === conversation),
      );
      out.push({ id: node.id, ids, nested });
    }
    for (const child of node.children ?? []) walk(child, out);
  };
  const grids = [];
  walk(state.tree, grids);
  const grid = grids.find((entry) => entry.nested || entry.ids.includes(conversation)) ?? grids[0];
  return { region: conversation ?? grid?.ids[0], gridId: grid?.id };
});
if (target.region === undefined || target.gridId === undefined) {
  throw new Error("no grid region found on the page");
}

const readGrid = () =>
  page.evaluate(({ id, regionId }) => {
    const walk = (node) => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    const grid = walk(globalThis.__pracLayout.getState().tree);
    const placements = grid.placements ?? {};
    const used = (axis) =>
      Math.max(
        1,
        ...Object.values(placements).map((placement) =>
          axis === "column"
            ? placement.column + (placement.columnSpan ?? 1)
            : placement.row + (placement.rowSpan ?? 1),
        ),
      );
    const domCells = [...document.querySelectorAll("[data-prac-grid-cell]")].map((cell) =>
      cell.getAttribute("data-prac-grid-cell"),
    );
    const stage = document.querySelector(`[data-prac-grid="${CSS.escape(id)}"]`);
    const regionBox = document.querySelector(`[data-prac-region="${CSS.escape(regionId)}"]`);
    return {
      id: grid.id,
      type: grid.type,
      children: grid.children.map((child) => child.id),
      rows: grid.rows,
      columns: grid.columns,
      placements,
      expectedRows: used("row"),
      expectedColumns: used("column"),
      domCells,
      stageWidth: stage?.getBoundingClientRect().width ?? null,
      regionWidth: regionBox?.getBoundingClientRect().width ?? null,
    };
  }, { id: target.gridId, regionId: target.region });

const problems = [];
const check = (label, grid) => {
  const childIds = new Set(grid.children);
  const placementIds = Object.keys(grid.placements ?? {});
  const stale = placementIds.filter((id) => !childIds.has(id));
  if (stale.length > 0) problems.push(`${label}: stale placements ${stale.join(",")}`);
  if (grid.rows !== grid.expectedRows) {
    problems.push(`${label}: rows ${grid.rows} != used ${grid.expectedRows}`);
  }
  if (grid.columns !== grid.expectedColumns) {
    problems.push(`${label}: columns ${grid.columns} != used ${grid.expectedColumns}`);
  }
  // A one-cell grid renders no cell wrapper (it is topology, not a box).
  const expectedCells = grid.children.length > 1 ? grid.children.length : 0;
  if (grid.domCells.length !== expectedCells) {
    problems.push(`${label}: ${grid.domCells.length} DOM cells for ${grid.children.length} children`);
  }
  console.log(
    `${label}: children=[${grid.children}] ${grid.columns}x${grid.rows} placements=${JSON.stringify(grid.placements)}`,
  );
};

// 1. Split / close cycle in every direction: each new empty cell is removed
//    again, which is the operation that used to leave its placement behind.
for (const side of ["right", "down", "left", "up"]) {
  const created = await page.evaluate(
    ({ region, side }) => globalThis.__pracLayout.createRegionBeside(region, side),
    { region: target.region, side },
  );
  if (created === undefined) throw new Error(`createRegionBeside(${side}) returned nothing`);
  await page.waitForTimeout(250);
  check(`after create ${side}`, await readGrid());

  const beforeRemove = await readGrid();
  if (!beforeRemove.children.includes(created)) {
    problems.push(`create ${side}: ${created} missing from children`);
  }

  await page.evaluate((id) => globalThis.__pracLayout.removeRegion(id), created);
  await page.waitForTimeout(250);
  const afterRemove = await readGrid();
  check(`after remove ${side}`, afterRemove);
  if (afterRemove.children.includes(created)) {
    problems.push(`remove ${side}: ${created} still a child`);
  }
  if (afterRemove.stageWidth !== null && afterRemove.regionWidth !== null) {
    const ratio = afterRemove.regionWidth / afterRemove.stageWidth;
    if (ratio < 0.95) {
      problems.push(`remove ${side}: cell is ${(ratio * 100).toFixed(1)}% of the stage`);
    }
  }
}

// 2. Merge then unmerge a fresh cell, then remove it: the sequence in the report.
const source = await page.evaluate(
  ({ region }) => globalThis.__pracLayout.createRegionBeside(region, "right"),
  { region: target.region },
);
if (source === undefined) throw new Error("merge fixture: createRegionBeside returned nothing");
await page.waitForTimeout(250);
const withTwo = await readGrid();
check("before merge", withTwo);

await page.evaluate(
  ({ gridId, source, target }) => globalThis.__pracLayout.mergeGridCells(gridId, source, target),
  { gridId: target.gridId, source, target: target.region },
);
await page.waitForTimeout(250);
const merged = await readGrid();
check("after merge", merged);

const mergedCell = merged.children[0];
await page.evaluate(
  ({ gridId, cellId }) => globalThis.__pracLayout.unmergeGridCell(gridId, cellId),
  { gridId: target.gridId, cellId: mergedCell },
);
await page.waitForTimeout(250);
check("after unmerge", await readGrid());

await page.evaluate((id) => globalThis.__pracLayout.removeRegion(id), source);
await page.waitForTimeout(250);
const final = await readGrid();
check("after remove merged source", final);

const screenshot = new URL("./stage-grid-fixed.png", import.meta.url).pathname;
await page.screenshot({ path: screenshot, fullPage: false });
console.log(`screenshot: ${screenshot}`);

await browser.close();

if (consoleErrors.length > 0) {
  console.log(`console errors:\n${consoleErrors.join("\n")}`);
}
if (problems.length > 0) {
  console.error(`FAIL\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("PASS");
