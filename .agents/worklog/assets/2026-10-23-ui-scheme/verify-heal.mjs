/**
 * Live recovery check for the stage state in the report: a grid whose active
 * window group (`center`) is gone and whose only cell is an editor group
 * (`region-2`). After reload the store must clip `active` to a real cell and the
 * arrangement must bring the conversation back into the surviving window group.
 *
 * URL="http://…/?token=…" node .scratch/verify-heal.mjs
 */
import { chromium } from "@playwright/test";

const url = process.env.URL;
if (!url) throw new Error("URL is required");

const broken = {
  viewportWidth: 1632,
  viewportHeight: 565,
  tree: {
    type: "split",
    id: "root",
    dir: "column",
    children: [
      {
        type: "split",
        id: "top",
        dir: "row",
        children: [
          {
            type: "region",
            id: "left",
            size: 280,
            flex: false,
            collapsed: false,
            cachedSize: 280,
            min: 120,
            stack: true,
            priority: "low",
            snap: true,
            selector: "rail",
            children: [
              {
                type: "region",
                id: "left/container:workbench.view.explorer",
                size: 0,
                flex: true,
                collapsed: false,
                cachedSize: 0,
                min: 120,
                label: "Explorer",
                stack: true,
              },
            ],
          },
          {
            type: "grid",
            id: "stage",
            rows: 1,
            columns: 1,
            children: [
              {
                type: "region",
                id: "region-2",
                size: 0,
                flex: true,
                collapsed: false,
                cachedSize: 0,
                min: 120,
                tabs: "multiple",
                embedder: true,
              },
            ],
            flex: true,
            min: 240,
            priority: "high",
            active: "center",
            placements: { "region-2": { row: 0, column: 0 } },
          },
          {
            type: "region",
            id: "right",
            size: 420,
            flex: false,
            collapsed: false,
            cachedSize: 420,
            min: 120,
            stack: true,
            priority: "low",
            snap: true,
            selector: "rail",
          },
        ],
      },
      {
        type: "region",
        id: "bottom",
        size: 240,
        flex: false,
        collapsed: false,
        cachedSize: 240,
        min: 120,
        stack: true,
        priority: "low",
        snap: true,
        selector: "none",
        children: [],
      },
    ],
  },
  views: {
    "dsh:sidebar": { region: "left/dsh:sidebar", order: 0, hidden: true, front: true },
    "dsh:rightbar": { region: "right", order: 0, hidden: true, front: true },
    "vscode:file:p1:file:///a.ts": {
      region: "region-2",
      order: 0,
      hidden: false,
      front: true,
      flags: { dirty: false, preview: false, closable: true },
    },
  },
  catalogueVersion: 42,
  activePanelId: null,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(2000);

if (await page.$("[data-prac-firstrun]")) {
  await page
    .locator("[data-prac-firstrun] button", { hasText: "prac-dev" })
    .first()
    .click();
  await page.waitForSelector("[data-prac-firstrun]", { state: "detached", timeout: 60_000 });
  await page.waitForTimeout(2500);
}

await page.evaluate((state) => {
  localStorage.setItem("prac-layout/v1", JSON.stringify(state));
}, broken);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForTimeout(3500);

const result = await page.evaluate(() => {
  const state = globalThis.__pracLayout.getState();
  const walk = (node, out = []) => {
    if (node.type === "region") out.push(node.id);
    for (const child of node.children ?? []) walk(child, out);
    return out;
  };
  const regions = new Set(walk(state.tree));
  const findGrid = (node) => {
    if (node.type === "grid") return node;
    for (const child of node.children ?? []) {
      const found = findGrid(child);
      if (found) return found;
    }
    return null;
  };
  const stage = findGrid(state.tree);
  const missing = Object.entries(state.views)
    .filter(([, record]) => record.hidden !== true && !regions.has(record.region))
    .map(([id, record]) => `${id}@${record.region}`);
  return {
    stage: stage === null ? null : {
      children: stage.children.map((child) => child.id),
      active: stage.active,
      columns: stage.columns,
      rows: stage.rows,
    },
    conversation: state.views["dsh:main:conversation"]?.region ?? null,
    sidebar: state.views["dsh:sidebar"] ?? null,
    leftChildren: (() => {
      const find = (node) => {
        if (node.id === "left") return node;
        for (const child of node.children ?? []) {
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      const left = find(state.tree);
      return left?.children?.map((child) => child.id) ?? null;
    })(),
    missing,
  };
});

console.log(JSON.stringify(result, null, 2));
const problems = [];
if (result.stage === null) problems.push("no stage grid");
else {
  if (result.stage.active !== "region-2") {
    problems.push(`stage.active = ${result.stage.active}, expected region-2`);
  }
  if (!result.stage.children.includes("region-2")) {
    problems.push("stage lost its only cell");
  }
  if (result.stage.children.includes("center")) {
    problems.push("stage still claims the removed center cell");
  }
}
if (result.conversation !== "region-2") {
  problems.push(`conversation at ${result.conversation}, expected region-2`);
}
if (result.missing.length > 0) {
  problems.push(`visible views with dead regions: ${result.missing.join(", ")}`);
}

await page.screenshot({
  path: new URL("./heal-after.png", import.meta.url).pathname,
});
await browser.close();

if (problems.length > 0) {
  console.error(`FAIL\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("PASS");
