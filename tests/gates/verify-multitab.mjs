/**
 * Diagnostic: can two browser tabs run two workbenches at once?
 *
 * Opt-in. Opens folder A in one tab and folder B in another, in the **same
 * browser context** (shared localStorage), and records whether both workbenches
 * boot, which state they share, and whether each keeps its own workspace.
 */
import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireUrl } from "./harness.mjs";

const selected = (process.env.PRAC_GATES ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("multitab");
if (!selected) {
  console.log("SKIPPED: select it explicitly (PRAC_GATES=multitab)");
  process.exit(0);
}

const url = requireUrl();
const root = await mkdtemp(join(tmpdir(), "prac-multitab-"));
const A = join(root, "alpha");
const B = join(root, "beta");
await mkdir(A, { recursive: true });
await mkdir(B, { recursive: true });
await writeFile(join(A, "a.txt"), "alpha\n", "utf8");
await writeFile(join(B, "b.txt"), "beta\n", "utf8");
const workspaceUrl = (path) => {
  const next = new URL(url);
  next.searchParams.set("workspace", path);
  return next.toString();
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const errors = [];
const watch = (page) => {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
};

async function ready(page, folder) {
  await page.goto(workspaceUrl(folder), { waitUntil: "load", timeout: 60_000 });
  await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
  await page.waitForFunction(
    (path) =>
      globalThis.__vscodeEmbed.face.workspaceInfo().folders.some((entry) => entry.includes(path)),
    folder,
    { timeout: 60_000 },
  );
  await page.waitForFunction(() => globalThis.__pracTest?.frame.listRegions().length > 0, null, {
    timeout: 60_000,
  });
}

const state = (page) =>
  page.evaluate(() => ({
    folder: globalThis.__vscodeEmbed.face.workspaceInfo().folders?.[0] ?? null,
    session: localStorage.getItem("dsh.sessions.current"),
    open: globalThis.__vscodeEmbed.face.listOpenFiles(),
    layoutKeys: Object.keys(localStorage).filter((key) => key.startsWith("prac-layout/v1/")).length,
  }));

const pageA = await context.newPage();
watch(pageA);
await ready(pageA, A);
const a = await state(pageA);

const pageB = await context.newPage();
watch(pageB);
await ready(pageB, B);
const b = await state(pageB);
const aAfterB = await state(pageA);

// Same folder in a second tab: do the two share layout/session, and do editors
// in one appear in the other?
const pageA2 = await context.newPage();
watch(pageA2);
await ready(pageA2, A);
const a2 = await state(pageA2);

process.stderr.write(
  `[multitab] ${JSON.stringify(
    { a, b, aAfterB, a2, pageCount: context.pages().length, consoleErrors: errors.slice(0, 10) },
    null,
    2,
  )}\n`,
);

await browser.close();
console.log("OK: multi-tab diagnostic recorded (see stderr)");
