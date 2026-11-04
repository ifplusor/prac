/**
 * A Space is a virtual desktop of the stage: switching it changes the stage
 * layout, while sidebar / panel geometry and their boards stay frame-level.
 * The active Space also survives a reload.
 */
import { clearLayoutState, openPrac, report, requireUrl, until } from "./harness.mjs";

const CONVERSATION = "dsh:main:conversation";
const url = requireUrl();
const { page, close } = await openPrac(url);

async function settle() {
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__pracFrame, null, { timeout: 60_000 });
  // The stage's regions are what this gate reads; wait for one to be laid out.
  await until(
    page,
    () => {
      const region = document.querySelector('[data-prac-region="left"]');
      return region !== null && region.getBoundingClientRect().width > 0;
    },
    null,
    { timeout: 10_000 },
  );
}

const stage = () =>
  page.evaluate(() => {
    const state = globalThis.__pracFrame.getState();
    const find = (node, id) => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const hit = find(child, id);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const count = (node) =>
      node.type === "region"
        ? 1
        : (node.children ?? []).reduce((sum, child) => sum + count(child), 0);
    const root = find(state.tree, "stage");
    return { regions: count(root), tree: JSON.stringify(root) };
  });

const leftWidth = () =>
  page.evaluate(() => {
    const region = document.querySelector('[data-prac-region="left"]');
    return region === null ? null : Math.round(region.getBoundingClientRect().width);
  });

const spaces = () =>
  page.evaluate(() => ({
    list: globalThis.__pracSpaces.list(),
    active: globalThis.__pracSpaces.active(),
  }));

await clearLayoutState(page);
await page.reload({ waitUntil: "load" });
await settle();

await page.evaluate((view) => globalThis.__pracFrame.splitItem(view, "right"), CONVERSATION);
await until(
  page,
  () => {
    const state = globalThis.__pracFrame.getState();
    const find = (node, id) => {
      if (node.id === id) return node;
      for (const child of node.children ?? []) {
        const hit = find(child, id);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    const count = (node) =>
      node.type === "region" ? 1 : (node.children ?? []).reduce((sum, child) => sum + count(child), 0);
    const root = find(state.tree, "stage");
    return count(root) === 2;
  },
  null,
  { timeout: 10_000 },
);
await page.evaluate(() => globalThis.__pracFrame.setWidth("left", 340));
await until(
  page,
  () => {
    const region = document.querySelector('[data-prac-region="left"]');
    return region !== null && Math.abs(region.getBoundingClientRect().width - 340) <= 1;
  },
  null,
  { timeout: 5000 },
);

const first = { stage: await stage(), left: await leftWidth(), spaces: await spaces() };
const created = await page.evaluate(() => globalThis.__pracSpaces.create("Space 2"));
await until(page, (id) => globalThis.__pracSpaces.list().length === 2 && globalThis.__pracSpaces.active() === id, created, {
  timeout: 5000,
});
const second = { stage: await stage(), left: await leftWidth(), spaces: await spaces() };

await page.reload({ waitUntil: "load" });
await settle();
const reloaded = { stage: await stage(), left: await leftWidth(), spaces: await spaces() };

await page.evaluate((id) => globalThis.__pracSpaces.switchTo(id), first.spaces.active);
await until(page, (id) => globalThis.__pracSpaces.active() === id, first.spaces.active, {
  timeout: 5000,
});
const back = { stage: await stage(), left: await leftWidth(), spaces: await spaces() };

await close();

report({
  url,
  facts: { first, created, second, reloaded, back },
  checks: {
    "the first Space has a split stage": first.stage.regions >= 2,
    "a new Space starts with the default stage": second.stage.regions === 1,
    "the active Space persists": reloaded.spaces.active === created,
    "the reloaded Space keeps the default stage": reloaded.stage.regions === 1,
    "the sidebar stays frame-level across Spaces":
      second.left === first.left && back.left === first.left,
    "switching back restores the stage": JSON.stringify(back.stage) === JSON.stringify(first.stage),
    "the Space list persists": reloaded.spaces.list.length === 2,
  },
  ok: "OK: Spaces are stage desktops — switching changes the stage, the sidebar stays, and the active Space survives a reload.",
});
