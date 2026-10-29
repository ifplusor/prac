/**
 * Verify the attention mechanism: the current **file view** must survive being
 * *moved* between the right track and the centre.
 *
 * Since decision 17 the editor is one view per open file (`vscode:file:<resource>`),
 * not the editor part: the file's host is `[data-vscode-embed-file]` and the
 * conversation (`dsh:main:conversation`) is the other surface attention can rest
 * on. A moved view is exactly where a DOM-level check lies: the node is still in
 * the document, still error-free, and blank. So each state is judged on pixels —
 * geometry, colour spread, and whether hiding the region changes the clip.
 *
 * Only one file is open, so exactly one file host may exist: a state that holds
 * its editor twice would mean a second editing surface (a second view of one
 * model), which is a failure.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-focus.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom } from "./deep-dom.mjs";
import { writeFixtures } from "./gate-fixtures.mjs";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const upstreamDir = process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode");
const url = process.env.URL;
if (!url) throw new Error("URL is required");
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test")))
  throw new Error("run vscode:build first");

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Decode a PNG in the page and report how much of it is not one flat colour. */
const analyse = async (base64) => {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = data.length / 4;
  let dominant = 0;
  for (const count of counts.values()) dominant = Math.max(dominant, count);
  return { distinctColours: counts.size, dominantShare: +(dominant / total).toFixed(4) };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error.message)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await installDeepDom(page);
await page.waitForSelector("[data-prac-focus-strip]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });

// Open one file before sampling — the current model has no editor view until the
// app opens a file. The expectation comes from the same file on disk, because the
// app's workspace is DSH's active workspace, not this repository.
// The gate's own file, opened by URI: the app's folder is DSH's last-used workspace,
// which is not this repository (see `gate-fixtures.mjs`). The marker is a line of the
// file as it is on disk.
const [PROBE] = writeFixtures("focus", url, [
  {
    name: "probe.txt",
    body: (token) =>
      `the focus probe ${token}\nsecond line\nthird line\nfourth line\nfifth line\nsixth line\nseventh line\neighth line\n`,
  },
]);
const MARKER = PROBE.marker;
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), PROBE.uri);
await page.waitForSelector("[data-vscode-embed-file] .monaco-editor", { timeout: 60_000 });
await page.waitForTimeout(3000);

/** Read the current state: strip, host geometry, and the file's paint. */
async function sample() {
  const facts = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const frame = globalThis.__deep.one("[data-prac-frame]");
    const hosts = [...globalThis.__deep.all("[data-vscode-embed-file]")].map((el, index) => ({
      index,
      region:
        globalThis.__deep.closest(el, "[data-prac-region]")?.getAttribute("data-prac-region") ??
        null,
      hasEditor: !!el.querySelector(".monaco-editor"),
      lines: el.querySelectorAll(".view-line").length,
      // Monaco renders text with non-breaking spaces; normalise before matching.
      text: (el.querySelector(".view-lines")?.textContent ?? "")
        .replace(/\u00a0/g, " ")
        .slice(0, 4000),
      box: box(el),
    }));
    return {
      focus:
        globalThis.__deep.one("[data-prac-focus-strip]")?.getAttribute("data-prac-focus-strip") ??
        null,
      hasStrip: !!globalThis.__deep.one("[data-prac-focus-strip]"),
      frame: box(frame),
      // The conversation's own region, from the layout probe: it is a view like
      // any other, so it moves with attention and the gate reads it here.
      conversationRegion:
        globalThis.__pracFrame?.getState?.().views?.["dsh:main:conversation"]?.region ?? null,
      hosts,
    };
  });

  const holders = facts.hosts.filter((host) => host.hasEditor);
  const host = holders[0] ?? null;
  let paint = null;
  if (host && host.box.w > 2 && host.box.h > 2) {
    const clip = { x: host.box.x, y: host.box.y, width: host.box.w, height: host.box.h };
    const painted = await page.screenshot({ clip });
    await page.evaluate(() => {
      globalThis.__deep.all("[data-vscode-embed-file]").forEach((el) => {
        el.style.visibility = "hidden";
      });
    });
    const hidden = await page.screenshot({ clip });
    await page.evaluate(() => {
      globalThis.__deep.all("[data-vscode-embed-file]").forEach((el) => {
        el.style.visibility = "";
      });
    });
    paint = {
      ...(await page.evaluate(analyse, painted.toString("base64"))),
      sha: sha(painted).slice(0, 12),
      differsWhenHidden: sha(painted) !== sha(hidden),
    };
  }
  return { ...facts, host, holderCount: holders.length, hostCount: facts.hosts.length, paint };
}

const states = {};

// Opening the file is the arrangement's `openFileInto`, and attention moves with
// it: the file takes the centre, the conversation parks in the track, and the
// strip reads `vscode`. A strip still saying `conversation` would be lying about
// what holds the centre (and `Control+Alt+1` would then be a no-op).
states.opened = await sample();

// Promote the file view with the keyboard shortcut (also exercises the binding).
await page.keyboard.press("Control+Alt+2");
await page.waitForTimeout(2000);
states.promoted = await sample();

// Conversation has attention: the file gives up the centre for the track.
await page.keyboard.press("Control+Alt+1");
await page.waitForTimeout(2000);
states.parked = await sample();

// And back to the file, so `back` has a file state to return from.
await page.keyboard.press("Control+Alt+2");
await page.waitForTimeout(2000);
states.repromoted = await sample();

// The keyboard's back binding returns attention to where it was.
await page.keyboard.press("Control+Alt+ArrowLeft");
await page.waitForTimeout(2000);
states.back = await sample();

await page.screenshot({ path: resolve(repoRoot, ".build/focus.png") });
await browser.close();

/** How far the file host's centre sits from the frame centre (negative = left). */
const offset = (state) => {
  if (!state.frame || !state.host) return null;
  return state.host.box.x + state.host.box.w / 2 - (state.frame.x + state.frame.w / 2);
};
const painted = (state) =>
  state.paint?.distinctColours > 4 && state.paint.differsWhenHidden === true;
const showsTheFile = (state) =>
  state.host !== null && state.host.lines > 0 && state.host.text.includes(MARKER);

const checks = {
  // The file is one instance: exactly one host, holding exactly one editing surface.
  fileInOneHost: [states.opened, states.promoted, states.parked, states.back].every(
    (state) => state.hostCount === 1 && state.holderCount === 1,
  ),
  // Attention is reported by the environment layer, not by a seat we displaced.
  stripPresent: states.opened.hasStrip && states.promoted.hasStrip && states.parked.hasStrip,
  stripFollowsFocus:
    states.opened.focus === "vscode" &&
    states.promoted.focus === "vscode" &&
    states.parked.focus === "conversation",
  // Promoted: the file holds the centre, and the track's width went to it.
  // (Where attention *places* the views is the arrangement's rule and a unit
  // test — `web-app`'s `arrangement.spec.ts`; what is live here is the file view
  // actually moving between regions and painting in each.)
  promotedFileCentred:
    states.promoted.host?.region === "center" && Math.abs(offset(states.promoted)) < 200,
  promotedWiderThanBeside: states.promoted.host.box.w > states.parked.host.box.w * 1.3,
  paintedThroughThePromotion:
    painted(states.opened) && painted(states.promoted) && painted(states.parked),
  // The move must not lose the editor's content: the rendered lines are still the
  // file's own text.
  contentSurvivesMove:
    showsTheFile(states.opened) &&
    showsTheFile(states.promoted) &&
    showsTheFile(states.parked) &&
    showsTheFile(states.back),
  // Parking the conversation in the centre sends the file back to the track.
  parkedParksTheFileInTheTrack:
    states.parked.host?.region === "right" &&
    states.parked.conversationRegion === "center" &&
    offset(states.parked) > 200,
  // Back returns attention to where it was: the conversation is centred again and
  // the file is back in the track, still painting.
  backReturns:
    states.back.focus === "conversation" &&
    states.back.host?.region === "right" &&
    states.back.conversationRegion === "center" &&
    offset(states.back) > 200 &&
    painted(states.back),
};

console.log(
  JSON.stringify(
    {
      url,
      workspace: { fixture: PROBE.name, marker: MARKER },
      checks,
      states: Object.fromEntries(
        Object.entries(states).map(([name, state]) => [
          name,
          {
            ...state,
            hosts: state.hosts.map((host) => ({ ...host, text: undefined })),
            paint: state.paint,
          },
        ]),
      ),
      errorCount: errors.length,
      errors: errors.slice(0, 6),
    },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length) {
  console.error(`\nFAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "\nOK: attention moves the current file view between the track and the centre, it still paints, and its text survives the move.",
);
