/**
 * Verification of **placement-level** hosting: one file's editing surface inside prac's
 * own editor group, in the region the frame renders it in.
 *
 * The unit is the **placement** — a file in one of the app's editor groups — because
 * prac owns which files are open, how they are grouped and the tab strip, while the app
 * owns how many groups hold each file (VS Code's Split Editor makes that two). What this
 * gate refuses to take on faith:
 *
 *  1. **a real editing surface** — the workbench's own text model for the file in a
 *     `CodeEditorWidget`: the rendered lines are that file's text, and the
 *     expectation is read back from the file on disk rather than hard-coded;
 *  2. **paint** — a structurally present, visually blank editor is the failure mode
 *     that looks healthy in the DOM;
 *  3. **one body per region** — a region shows the front view's surface and nothing
 *     else, a tab click brings that file's surface back, and a region of its own is a
 *     second group showing its own file;
 *  4. **close + reopen** — closing the file releases the surface, and the app's next
 *     open builds a fresh one, with a failed mount reported rather than thrown at the
 *     embedder;
 *  5. **one file in two groups** — the app's own split copies the editor into a second
 *     group, and prac answers with two placements, two views and two surfaces (the same
 *     text, twice), rather than one view torn between two hosts.
 *
 * The gate writes its own fixture files and opens them by URI, so it depends on
 * neither the folder the app happens to have open nor on this repository's contents.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-file.mjs
 */
import { createRequire } from "node:module";
import { installDeepDom, resourceOfFileView } from "./deep-dom.mjs";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const upstreamDir = workDir;
const url = process.env.URL;

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

/** The authority behind the page's file URIs (`vscode-remote://<authority>/<path>`). */
const remoteAuthority = new URL(url).host;

/**
 * Write the gate's own fixture files, and read them back for their markers.
 *
 * Four small files, each carrying a token that exists nowhere else, so "the editor
 * shows this file's text" is a claim about the file on disk rather than about a
 * string the gate also happened to write into the assertion. They live under the
 * build's scratch directory and are opened by URI — the workbench's file service
 * serves any path under its remote authority — which keeps the gate independent of
 * whichever folder the app has open.
 *
 * @returns the fixtures: each one's name, its full URI, and a marker line of its text.
 */
function writeFixtures() {
  const token = randomUUID().slice(0, 8);
  const dir = join(repoRoot, ".build/scratch/gate-fixtures");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const written = [
    {
      name: "alpha.json",
      text: `{\n  "gate": "alpha-${token}",\n  "lines": ${token.length}\n}\n`,
    },
    {
      name: "beta.md",
      text: `# beta ${token}\n\nA second file, so the region has two views to show.\n`,
    },
    {
      name: "gamma.txt",
      text: `gamma ${token}\n\nThe third file, for the tab strip.\n`,
    },
    {
      name: "delta.txt",
      text: `delta ${token}\n\nThe fourth file, opened last.\n`,
    },
  ];
  return written.map((file) => {
    const path = join(dir, file.name);
    writeFileSync(path, file.text, "utf8");
    // Read back: the marker is a line of the file as it is on disk.
    const marker = readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.includes(token));
    if (marker === undefined) throw new Error(`no marker line in ${path}`);
    return { name: file.name, path, marker, uri: `vscode-remote://${remoteAuthority}${path}` };
  });
}

const analyse = async (base64) => {
  const image = new Image();
  image.src = "data:image/png;base64," + base64;
  await image.decode();
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  const counts = new Set();
  for (let i = 0; i < data.length; i += 4) {
    counts.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  return counts.size;
};

/**
 * Say which phase the gate is in.
 *
 * The gate's report is one JSON document at the end, so a run that hangs leaves no
 * evidence at all. Each phase announces itself on stderr, which is what makes a hang
 * diagnosable (measured: an unbounded `diagnostics.settled()` hung a run silently).
 *
 * @param phase - the phase's name.
 */
const step = (phase) => process.stderr.write(`[verify-file] ${phase}\n`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

step("boot");
await page.goto(url, { waitUntil: "load", timeout: 60_000 });
if ((await page.locator("[data-prac-firstrun]").count()) > 0) {
  const rows = page.locator(".prac-firstrun-row");
  if ((await rows.count()) > 0) {
    await rows.first().click();
  } else {
    const input = page.locator(".prac-firstrun-input");
    if ((await input.count()) > 0) {
      await input.fill(process.cwd());
      await page.locator(".prac-firstrun-button").click();
    }
  }
}
await installDeepDom(page);
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
// The face is published from inside the workbench, once its service graph has
// restored — that is the whole point of the bridge's direction.
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
const folder = await page.evaluate(
  () => (globalThis.__vscodeEmbed.face.workspaceInfo().folders ?? [])[0] ?? null,
);
const ALL_FIXTURES = writeFixtures();
const FILES = ALL_FIXTURES.slice(0, 2);
const REST = ALL_FIXTURES.slice(2);
/** The pair the surface phases open: a JSON file and a text file. */
const [FILE_A, FILE_B] = FILES;
/** The pair the event and tab phases open afterwards. */
const [FILE_C, FILE_D] = REST;

/** Wait until a resource's surface is the live editor body, then let it paint. */
async function waitForSurface(resource, timeout = 60_000) {
  await page.waitForFunction(
    (uri) =>
      globalThis.__deep
        .all(`[data-vscode-embed-file="${uri}"]`)
        .some((element) => element.querySelector(".monaco-editor")),
    resource,
    { timeout },
  );
  // Present but not yet laid out paints nothing, and "present, blank" is this
  // gate's failure mode — so let the frame lay the new body out before measuring.
  await page.waitForTimeout(2500);
}

/** One file's surface: its box, rendered text, paint and editor identity. */
async function measure(resource) {
  const facts = await page.evaluate((uri) => {
    const element = globalThis.__deep
      .all(`[data-vscode-embed-file="${uri}"]`)
      .find((candidate) => candidate.querySelector(".monaco-editor"));
    const box = (target) => {
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    // Monaco renders text with non-breaking spaces; normalise before matching.
    const text = (element?.querySelector(".view-lines")?.textContent ?? "").replace(/\u00a0/g, " ");
    return {
      host: box(element),
      editors: element?.querySelectorAll(".monaco-editor").length ?? 0,
      lines: element?.querySelectorAll(".view-line").length ?? 0,
      text: text.slice(0, 4000),
      region: element
        ? (globalThis.__deep
            .closest(element, "[data-prac-region]")
            ?.getAttribute("data-prac-region") ?? null)
        : null,
    };
  }, resource);
  facts.colours = 0;
  const host = facts.host;
  if (host && host.w > 2 && host.h > 2) {
    const shot = await page.screenshot({
      clip: { x: host.x, y: host.y, width: host.w, height: host.h },
    });
    facts.colours = await page.evaluate(analyse, shot.toString("base64"));
  }
  const lines = consoleErrors.filter((line) => line.includes("vscode-embed"));
  facts.mountErrors = lines.length;
  facts.mountMessages = lines.map((line) => line.slice(0, 300));
  return facts;
}

/** Every live surface: which resource each region shows, and what it renders. */
const liveSurfaces = () =>
  page.evaluate(() =>
    globalThis.__deep.all("[data-vscode-embed-file]").map((element) => ({
      resource: element.getAttribute("data-vscode-embed-file"),
      region:
        globalThis.__deep
          .closest(element, "[data-prac-region]")
          ?.getAttribute("data-prac-region") ?? null,
      editors: element.querySelectorAll(".monaco-editor").length,
      lines: element.querySelectorAll(".view-line").length,
    })),
  );

/** The centre region's tab strip: one entry per view, `active` on the front one. */
const tabsOf = () =>
  page.evaluate(() =>
    [...globalThis.__deep.all("[data-prac-tab]")].map((element) => ({
      id: element.getAttribute("data-prac-tab"),
      active: element.getAttribute("data-prac-tab-active") === "true",
    })),
  );

/** A fixture's URI string, as the workbench and the frame both name it. */
const uriOf = (file) => file.uri;

// **The app opens the file** — an explorer click, a command, go-to-definition: the
// workbench creates the pane, the frame renders that file's view in the centre
// region, and the region's group mounts its element into the view host the frame
// rendered. So what a person sees is prac's own editor group showing the workbench's
// pane, and the group belongs to the region.
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_A));
await waitForSurface(uriOf(FILE_A));
step("first file");
const mounted = await measure(uriOf(FILE_A));
const oneSurface = await liveSurfaces();

// A second file: the app keeps both open (two tabs), the centre shows the front view,
// and the group's pane holds the file it shows. One surface — the first file's
// element is *gone* rather than blank, because a region has one editor body.
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_B));
await waitForSurface(uriOf(FILE_B));
step("second file");
const second = await measure(uriOf(FILE_B));
const afterSecond = await liveSurfaces();
const twoFiles = await tabsOf();

// Clicking the first file's tab re-fronts its view (order is what a tab strip renders
// first), so its surface comes back — and the app's active editor follows, because
// prac's front view and the app's active editor are reconciled through the
// capability's `activate`.
const firstTab = twoFiles.find((tab) => tab.id?.endsWith(FILE_A.name)) ?? null;
if (firstTab === null) throw new Error("the first file has no tab to click");
step("tab click");
await page.click(`[data-prac-tab="${firstTab.id}"]`);
await waitForSurface(uriOf(FILE_A));
const back = await measure(uriOf(FILE_A));
const backSurfaces = await liveSurfaces();
const clicked = await tabsOf();
const activeAfterClick = await page.evaluate(
  () =>
    globalThis.__vscodeEmbed.face.capabilities.editors.snapshot().find((entry) => entry.active)
      ?.resource,
);

// A region that holds a file owns a **group**, so a region of its own is a second
// group: splitting the file's view out moves the view, the frame renders it in the
// new region, and that region's group shows the same file. Two regions, two groups,
// one surface each — VS Code's model, with prac's regions as its grid.
step("split region");
await page.evaluate(
  (resource) => globalThis.__pracLayout.splitView(globalThis.__pracFileView(resource), "right"),
  uriOf(FILE_A),
);
await waitForSurface(uriOf(FILE_A));
await page.waitForTimeout(1500);
const split = await liveSurfaces();
// …and moving it back leaves one region, so one group shows it again.
step("merge region");
await page.evaluate(
  (resource) => globalThis.__pracLayout.place(globalThis.__pracFileView(resource), "center"),
  uriOf(FILE_A),
);
await waitForSurface(uriOf(FILE_A));
await page.waitForTimeout(1500);
const merged = await liveSurfaces();

// Closing the file releases its surface *and* its tab, and the app's next open builds
// a fresh one. A surface left behind after a close would be an editor nobody owns.
step("close file");
await page.evaluate((resource) => {
  const placement = globalThis.__vscodeEmbed.face
    .listPlacements()
    .find((p) => p.resource === resource);
  globalThis.__vscodeEmbed.face.capabilities.editors.actions.close(placement.placement, resource);
}, uriOf(FILE_A));
await page.waitForFunction(
  (uri) => globalThis.__deep.all(`[data-vscode-embed-file="${uri}"]`).length === 0,
  uriOf(FILE_A),
  { timeout: 60_000 },
);
const closed = await liveSurfaces();
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_A));
await waitForSurface(uriOf(FILE_A));
const reopened = await measure(uriOf(FILE_A));

// The app's own openings reach the embedder as events — otherwise the app would be
// editing files nobody can see. `openFile` is the same editor-service call an explorer
// click makes; an untitled buffer (a model, and no file system provider) must not be
// offered as a file.
await page.evaluate((uri) => {
  const face = globalThis.__vscodeEmbed.face;
  const events = [];
  globalThis.__openFileProbe = { events, before: face.listPlacements() };
  globalThis.__stopOpenFileProbe = face.onDidChangePlacements(() => {
    events.push(face.listPlacements());
  });
  face.openFile(uri);
  face.openUntitled();
}, uriOf(FILE_C));
await page.waitForTimeout(2500);
step("app opens a file");
const opened = await page.evaluate(() => ({
  before: globalThis.__openFileProbe.before,
  events: globalThis.__openFileProbe.events,
  after: globalThis.__vscodeEmbed.face.listPlacements(),
}));
await page.evaluate(() => globalThis.__stopOpenFileProbe?.());

// Tabs: one per open file, exactly one of them front, and a further open adds one
// rather than replacing a neighbour's.
const beforeLastOpen = await tabsOf();
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_D));
await page.waitForFunction(
  (count) => globalThis.__deep.all("[data-prac-tab]").length === count + 1,
  beforeLastOpen.length,
  { timeout: 60_000 },
);
await page.waitForTimeout(2500);
step("last open");
const lastOpen = await tabsOf();

// Decision 21's first capability: the open editor set, addressed by name rather
// than by whichever view happens to be mounted.
const capability = () =>
  page.evaluate(() => {
    const editors = globalThis.__vscodeEmbed.face.capabilities.editors;
    // The chrome the seat pushes from this capability: a tab's dot.
    const tabs = [...globalThis.__deep.all("[data-prac-tab]")].map((element) => ({
      resource: globalThis.__pracFileResource(element.getAttribute("data-prac-tab") ?? ""),
      dirty: element.getAttribute("data-prac-tab-dirty") === "true",
      preview: element.getAttribute("data-prac-tab-preview") === "true",
    }));
    return {
      snapshot: editors.snapshot(),
      version: editors.version(),
      open: globalThis.__vscodeEmbed.face.listOpenFiles(),
      tabs,
    };
  });

step("editors capability");
const capabilityBefore = await capability();
const activeResource = capabilityBefore.snapshot.find((entry) => entry.active)?.resource ?? null;
if (activeResource === null) throw new Error("no active editor to exercise the capability with");
// Bring that file's view to the front (what clicking its prac tab does), which
// mounts its surface — then tell the app the same thing through the capability's
// `activate`. Both halves matter: prac's front view and the app's active editor are
// two states, and the UI keeps them in step through this action.
await page.evaluate(
  (resource) => globalThis.__pracLayout.place(globalThis.__pracFileView(resource), "center"),
  activeResource,
);
await page.waitForTimeout(1500);
await page.evaluate(
  (resource) => globalThis.__vscodeEmbed.face.capabilities.editors.actions.activate(resource),
  activeResource,
);
await page.waitForTimeout(1200);
const capabilityActivated = await capability();
if (
  !capabilityActivated.snapshot.some((entry) => entry.resource === activeResource && entry.active)
) {
  throw new Error("activate did not make the file the app's active editor");
}
// Which file's surface is actually mounted? One resource has one surface, and this
// gate has been moving editors between a prac view and its own probe hosts, so the
// typing below targets whatever is mounted rather than assuming which host won.
const surfaceResource = await page.evaluate(
  () =>
    [...globalThis.__deep.all("[data-vscode-embed-file]")]
      .find((element) => element.querySelector(".view-lines"))
      ?.getAttribute("data-vscode-embed-file") ?? null,
);
if (surfaceResource === null) {
  const dump = await page.evaluate(() => ({
    hosts: [...globalThis.__deep.all("[data-vscode-embed-file]")].map((element) => ({
      file: element.getAttribute("data-vscode-embed-file")?.split("/").pop(),
      inRegion:
        globalThis.__deep
          .closest(element, "[data-prac-region]")
          ?.getAttribute("data-prac-region") ?? null,
      children: element.children.length,
      monaco: element.querySelectorAll(".monaco-editor").length,
    })),
    records: Object.entries(globalThis.__pracLayout.getState().views)
      .filter(([id]) => id.startsWith("vscode:file:"))
      .map(([id, view]) => `${id.split("/").pop()}@${view.region}${view.hidden ? "(hidden)" : ""}`),
    open: globalThis.__vscodeEmbed.face.listOpenFiles().map((r) => r.split("/").pop()),
    tabs: [...globalThis.__deep.all("[data-prac-tab]")].map((e) =>
      e.getAttribute("data-prac-tab")?.split("/").pop(),
    ),
  }));
  throw new Error(`no mounted editor surface to type into: ${JSON.stringify(dump)}`);
}
// Unsaved changes are the app's, not the surface's: type into it and the
// capability must say so — and so must the tab's dot.
await page
  .locator(`[data-vscode-embed-file="${surfaceResource}"]`)
  .filter({ has: page.locator(".view-lines") })
  .first()
  .locator(".view-lines")
  .click();
await page.keyboard.type("x");
await page.waitForTimeout(1800);
const capabilityDirty = await capability();
// Undo it. A *dirty* editor is not closed without a decision (the app asks, which
// is correct — this action does not force it), and its hot-exit backup comes back
// after a reload (also correct). Both would make the phases below test the wrong
// thing, so the gate returns the file to clean — and asserts both consumers saw it.
await page.keyboard.press("ControlOrMeta+Z");
await page.waitForTimeout(1500);
const capabilityUndone = await capability();
// The criterion the whole layer rests on: the same answer with the view hidden —
// which also *releases* that file's surface (the seat unmounts), so the app is the
// only thing left that knows the file is open.
await page.evaluate((resource) => {
  globalThis.__pracLayout.hide(globalThis.__pracFileView(resource));
}, surfaceResource);
await page.waitForTimeout(1500);
const capabilityHidden = await capability();
// Closing the editor is an action of the capability, and the view follows.
await page.evaluate((resource) => {
  const placement = globalThis.__vscodeEmbed.face
    .listPlacements()
    .find((p) => p.resource === resource);
  globalThis.__vscodeEmbed.face.capabilities.editors.actions.close(placement.placement, resource);
}, surfaceResource);
await page.waitForTimeout(2500);
const capabilityClosed = await capability();

// `diagnostics` — the first capability whose data arrives *late*. The rig now has
// a marker source (cSpell, installed through the extension gate), so the gate holds
// it to the **contract**, which must hold whether or not anything is wrong in the
// workspace: the summary is the same set the query returns, a page reports what it
// was taken from, a scoped query filters, and `settled()` waits for quiet instead
// of answering while markers are still arriving.
step("diagnostics capability");
const diagnosticsProbe = await page.evaluate(async () => {
  const diagnostics = globalThis.__vscodeEmbed.face.capabilities.diagnostics;
  const before = diagnostics.version();
  const started = performance.now();
  // Bounded: `settled()` is a promise about quiet, and a marker source that never
  // quiets would otherwise hang the whole gate with no evidence.
  await Promise.race([diagnostics.settled(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  const settledMs = Math.round(performance.now() - started);
  // The whole set, to check the summary against: the summary may not be a second
  // count of its own.
  const all = diagnostics.query({ limit: 100000 });
  const counts = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const entry of all.entries) counts[entry.severity] += 1;
  return {
    snapshot: diagnostics.snapshot(),
    all,
    counts,
    resources: new Set(all.entries.map((entry) => entry.resource)).size,
    page: diagnostics.query({ limit: 2, offset: 1 }),
    scoped: diagnostics.query({ resource: "vscode-remote://127.0.0.1:3084/nope" }),
    settledMs,
    versionBefore: before,
    versionAfter: diagnostics.version(),
  };
});

// A reload forgets the app's editors, and the frame must forget the views with
// them: a persisted placement record outlives the file, and left alone it renders
// a tab for a file nobody has open and holds the centre with an empty view.
step("reload");
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
await page.waitForTimeout(6000);
const reloaded = await page.evaluate(() => ({
  open: globalThis.__vscodeEmbed.face.listOpenFiles(),
  fileHosts: globalThis.__deep.all("[data-vscode-embed-file]").length,
  fileTabs: [...globalThis.__deep.all("[data-prac-tab]")]
    .map((element) => element.getAttribute("data-prac-tab"))
    .filter((id) => id !== null && id.startsWith("vscode:file:")),
  conversationRegion:
    globalThis.__pracLayout.getState().views["dsh:main:conversation"]?.region ?? null,
}));

// The unit of a view is the **placement** — a file in one of the app's editor groups
// — not the file. VS Code's own split copies the editor into a second group, and prac
// has to answer with two placements, two views and two surfaces; one view torn between
// two hosts (or a second view with no surface) is the failure this catches.
step("split editor");
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_A));
await waitForSurface(uriOf(FILE_A));
await page.evaluate((uri) => globalThis.__vscodeEmbed.face.openFile(uri), uriOf(FILE_B));
await waitForSurface(uriOf(FILE_B));
await page.waitForTimeout(2000);
// The second group is made the way prac makes one — a region split — and then the app's
// own command copies the active editor into it. (`addGroup` is deliberately not the way:
// prac owns the region tree, so a group the workbench makes on its own would have no
// region until the frame renders a view for it.)
await page.evaluate(
  (resource) => globalThis.__pracLayout.splitView(globalThis.__pracFileView(resource), "right"),
  uriOf(FILE_B),
);
await page.waitForTimeout(3000);
// A comes back to the front of the centre, and a click in its surface makes that region's
// group the app's **active** one — which is what decides whose editor the command copies
// (a split copies the active editor, and the split just made the other group active).
await page.evaluate(
  (resource) => globalThis.__pracLayout.place(globalThis.__pracFileView(resource), "center"),
  uriOf(FILE_A),
);
await waitForSurface(uriOf(FILE_A));
await page.waitForTimeout(2500);
const centre = await page.evaluate((uri) => {
  const element = globalThis.__deep.one(`[data-vscode-embed-file="${uri}"]`);
  const box = element?.getBoundingClientRect();
  return box === undefined
    ? null
    : { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}, uriOf(FILE_A));
if (centre === null) throw new Error("the centre shows no surface to click");
await page.mouse.click(centre.x, centre.y);
await page.waitForTimeout(2000);
const splitRan = await page.evaluate(async () => {
  try {
    await globalThis.__vscodeEmbed.commands.executeCommand(
      "workbench.action.splitEditorToNextGroup",
    );
    return "ran";
  } catch (error) {
    return `threw: ${String(error).slice(0, 120)}`;
  }
});
await page.waitForFunction(
  (resource) =>
    globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === resource).length === 2,
  uriOf(FILE_A),
  { timeout: 60_000 },
);
await page.waitForTimeout(3000);
const copied = await page.evaluate(
  (resource) => ({
    placements: globalThis.__vscodeEmbed.face
      .listPlacements()
      .filter((placement) => placement.resource === resource),
    views: globalThis.__pracFileViews(resource),
    surfaces: globalThis.__deep.all(`[data-vscode-embed-file="${resource}"]`).map((element) => ({
      placement: element.getAttribute("data-vscode-embed-placement"),
      groups: element.querySelectorAll(".prac-window-group").length,
      region:
        globalThis.__deep
          .closest(element, "[data-prac-region]")
          ?.getAttribute("data-prac-region") ?? null,
      lines: element.querySelectorAll(".view-line").length,
      text: (element.querySelector(".view-lines")?.textContent ?? "").replace(/\u00a0/g, " "),
    })),
  }),
  uriOf(FILE_A),
);

// The workbench's directional group lookups are geometry, and the frame owns the tree: asking
// for the group to the left/right has to land in the region that actually sits there. The
// signal is the focused element's region — the editors capability's `active` flag is per group
// and cannot tell them apart (measured: both placements report active).
step("focus the group to the left and to the right");
const focusRegion = async (command) => {
  await page.evaluate((name) => globalThis.__vscodeEmbed.commands.executeCommand(name), command);
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const element = document.activeElement;
    const region = element ? globalThis.__deep.closest(element, "[data-prac-region]") : null;
    return region?.getAttribute("data-prac-region") ?? null;
  });
};
const focusedLeft = await focusRegion("workbench.action.focusLeftGroup");
const focusedRight = await focusRegion("workbench.action.focusRightGroup");

// Closing a tab closes **that placement**, not the resource: the app's own semantics
// (upstream closes one group's editor instance and leaves the other group's alone), and the
// reason `close` takes a placement rather than a URI.
step("close one of the two placements");
const closedOne = await page.evaluate(async (resource) => {
  const face = globalThis.__vscodeEmbed.face;
  const [first] = face.listPlacements().filter((placement) => placement.resource === resource);
  face.capabilities.editors.actions.close(first.placement, resource);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return {
    closed: first.placement,
    placements: face
      .listPlacements()
      .filter((placement) => placement.resource === resource)
      .map((placement) => placement.placement),
    surfaces: globalThis.__deep.all(`[data-vscode-embed-file="${resource}"]`).map((element) => ({
      placement: element.getAttribute("data-vscode-embed-placement"),
      lines: element.querySelectorAll(".view-line").length,
    })),
    openFiles: face.listOpenFiles(),
  };
}, uriOf(FILE_A));

await browser.close();

const painted = (colours) => typeof colours === "number" && colours > 4;
const checks = {
  // 1. Real editing surfaces: the workbench's model, rendered as lines of text. The
  // app opened the file and the frame showed it; nothing here mounted anything.
  firstFileIsTheOnlySurface:
    mounted.editors === 1 &&
    oneSurface.length === 1 &&
    oneSurface[0].resource === uriOf(FILE_A) &&
    mounted.region === "center",
  firstShowsItsOwnText: mounted.lines > 3 && mounted.text.includes(FILE_A.marker),
  secondShowsItsOwnText: second.lines > 3 && second.text.includes(FILE_B.marker),
  // 2. Paint, because present-but-blank is the failure mode.
  firstFileIsPainted: painted(mounted.colours),
  secondFileIsPainted: painted(second.colours),
  // 3. One body per region: the front file is the only surface, and the file that
  // was front is *gone* rather than left behind empty.
  oneSurfacePerRegion:
    afterSecond.length === 1 &&
    afterSecond[0].resource === uriOf(FILE_B) &&
    afterSecond[0].editors === 1,
  // 4. The tab click brings the surface back — the same file, one editor — and the
  // app's own active editor follows the click.
  clickingTheTabBringsTheSurfaceBack:
    back.editors === 1 &&
    back.lines > 3 &&
    back.text.includes(FILE_A.marker) &&
    backSurfaces.length === 1 &&
    backSurfaces[0].resource === uriOf(FILE_A),
  clickedTabIsTheAppsActiveEditor:
    activeAfterClick !== null &&
    activeAfterClick === resourceOfFileView(clicked.find((tab) => tab.active)?.id ?? ""),
  // 5. A region of its own is a second group: both files are shown at once, one
  // surface each, in two different regions — and merging back is one region again.
  secondRegionIsASecondGroup:
    split.length === 2 &&
    split.every((surface) => surface.editors === 1) &&
    new Set(split.map((surface) => surface.region)).size === 2,
  mergeIsOneGroupAgain: merged.length === 1 && merged[0].editors === 1,
  // 6. Closing releases the surface, and the app's next open builds a fresh one.
  closeReleasesTheSurface:
    closed.length >= 1 && closed.every((surface) => surface.resource !== uriOf(FILE_A)),
  reopenBuildsItAgain:
    reopened.editors === 1 && reopened.lines > 3 && reopened.text.includes(FILE_A.marker),
  // 7. Tabs: one per open file, exactly one front, and another open adds one.
  stripShowsEveryOpenFile:
    twoFiles.length >= 1 && twoFiles.filter((tab) => tab.active).length === 1,
  clickBringsItForward:
    clicked.length === twoFiles.length &&
    clicked.find((tab) => tab.active)?.id === firstTab.id &&
    clicked.filter((tab) => tab.active).length === 1,
  anotherOpenAddsATab:
    lastOpen.length === beforeLastOpen.length + 1 &&
    lastOpen.filter((tab) => tab.active).length === 1,
  newestFileIsActive: lastOpen.find((tab) => tab.active)?.id.endsWith(FILE_D.name) === true,
  // 9. The capability: one handle for both consumers, and no UI required.
  capabilityUndoesChanges: capabilityUndone.snapshot.some(
    (entry) => entry.resource === surfaceResource && !entry.dirty,
  ),
  tabMarksUnsavedChanges:
    capabilityDirty.tabs.some((tab) => tab.resource === surfaceResource && tab.dirty) &&
    capabilityBefore.tabs.some((tab) => tab.resource === surfaceResource && !tab.dirty),
  tabClearsTheMarkOnUndo: capabilityUndone.tabs.some(
    (tab) => tab.resource === surfaceResource && !tab.dirty,
  ),
  capabilityActivatesTheClickedFile: capabilityActivated.snapshot.some(
    (entry) => entry.resource === activeResource && entry.active,
  ),
  capabilityListsTheOpenFiles:
    capabilityBefore.snapshot.length >= 1 &&
    capabilityBefore.snapshot.filter((entry) => entry.active).length === 1 &&
    capabilityBefore.snapshot.every((entry) => entry.dirty === false),
  capabilityReportsUnsavedChanges:
    capabilityDirty.version > capabilityBefore.version &&
    capabilityDirty.snapshot.some((entry) => entry.resource === surfaceResource && entry.dirty),
  capabilityWorksWithTheViewHidden: capabilityHidden.snapshot.some(
    (entry) => entry.resource === surfaceResource,
  ),
  capabilityCloseRemovesTheEditor:
    capabilityClosed.snapshot.every((entry) => entry.resource !== surfaceResource) &&
    capabilityClosed.open.every((resource) => resource !== surfaceResource) &&
    capabilityClosed.version > capabilityHidden.version,
  // 10. A reload takes the files with it — and takes their views with them.
  reloadForgetsTheFiles: reloaded.open.length === 0 && reloaded.fileHosts === 0,
  noTabForAClosedFile: reloaded.fileTabs.length === 0,
  conversationTakesTheCentreBack: reloaded.conversationRegion === "center",
  // 11. The diagnostics capability's contract.
  diagnosticsSummaryIsTheSameSet: (() => {
    const { summary } = diagnosticsProbe.snapshot;
    const derived = diagnosticsProbe.counts;
    return (
      summary.error === derived.error &&
      summary.warning === derived.warning &&
      summary.info === derived.info &&
      summary.hint === derived.hint &&
      summary.resources === diagnosticsProbe.resources
    );
  })(),
  diagnosticsPageIsBounded:
    diagnosticsProbe.snapshot.page.total === diagnosticsProbe.all.total &&
    diagnosticsProbe.snapshot.page.entries.length <= 100 &&
    diagnosticsProbe.snapshot.page.entries.length === Math.min(100, diagnosticsProbe.all.total),
  diagnosticsPagingEchoes:
    diagnosticsProbe.page.offset === 1 &&
    diagnosticsProbe.page.total === diagnosticsProbe.all.total &&
    diagnosticsProbe.page.entries.length <= 2,
  diagnosticsScopeFilters: diagnosticsProbe.scoped.entries.length === 0,
  // With a source present, arrival must have moved the version — the fact `settled`
  // is about.
  diagnosticsVersionMovesWithMarkers:
    diagnosticsProbe.all.total === 0 ? true : diagnosticsProbe.versionBefore > 0,
  // The point of `settled`: a resolved-immediately promise would pass every other
  // check here and still hand a consumer a half-arrived set as the truth.
  diagnosticsSettledWaitsForQuiet:
    diagnosticsProbe.settledMs >= 300 && diagnosticsProbe.settledMs < 2500,
  diagnosticsVersionIsReadable: diagnosticsProbe.versionAfter >= diagnosticsProbe.versionBefore,
  // A failed mount is logged by the composition, not thrown at the embedder.
  noMountErrors:
    mounted.mountErrors === 0 &&
    second.mountErrors === 0 &&
    back.mountErrors === 0 &&
    reopened.mountErrors === 0,
  // 11. Split editor: one file, two placements, two views, two surfaces. The app
  // reports the *placement* (a file in a group), prac gives each its own view, and
  // each view gets its own editing surface — the same file, twice.
  // 12. Closing one placement leaves the other one open, with its own surface: the tab asked
  // about one editor instance, and the resource is still open in the app afterwards.
  // 11b. Directional focus follows the region tree: LEFT lands in the region the split made on
  // the left (the one that was already there) and RIGHT in the new one beside it.
  directionalFocusFollowsTheTree:
    copied.placements.length === 2 &&
    focusedLeft === mounted.region &&
    focusedRight !== null &&
    focusedRight !== mounted.region &&
    copied.placements.some((placement) => placement.region === focusedRight),
  onePlacementClosedNotTheResource:
    closedOne.placements.length === 1 &&
    closedOne.placements[0] !== closedOne.closed &&
    closedOne.surfaces.length === 1 &&
    closedOne.surfaces[0].placement === closedOne.placements[0] &&
    closedOne.surfaces[0].lines > 0 &&
    closedOne.openFiles.includes(uriOf(FILE_A)),
  splitEditorCopiesThePlacement:
    splitRan === "ran" &&
    copied.placements.length === 2 &&
    new Set(copied.placements.map((placement) => placement.group)).size === 2,
  twoPlacementsAreTwoViews: copied.views.length === 2,
  twoViewsAreTwoSurfaces:
    copied.surfaces.length === 2 &&
    copied.surfaces.every((surface) => surface.lines > 3) &&
    copied.surfaces.every((surface) => surface.text.includes(FILE_A.marker)) &&
    new Set(copied.surfaces.map((surface) => surface.region)).size === 2,
};

console.log(
  JSON.stringify(
    {
      url,
      workspace: {
        folder,
        files: FILES.map((file) => file.name),
        rest: REST.map((file) => file.name),
        markers: FILES.map((file) => file.marker),
      },
      surfaces: {
        first: { ...mounted, text: undefined },
        second: { ...second, text: undefined },
        back: { ...back, text: undefined },
        reopened: { ...reopened, text: undefined },
        oneSurface,
        afterSecond,
        split,
        closedOne,
        focusedLeft,
        focusedRight,
        merged,
        closed,
        mountMessages: mounted.mountMessages,
      },
      opened: { before: opened.before, after: opened.after, eventCount: opened.events.length },
      copied,
      reloaded,
      diagnostics: diagnosticsProbe,
      capability: {
        before: capabilityBefore.snapshot.length,
        dirty: capabilityDirty.snapshot,
        hidden: capabilityHidden.snapshot.length,
        closed: capabilityClosed.snapshot.length,
        versions: [
          capabilityBefore.version,
          capabilityDirty.version,
          capabilityUndone.version,
          capabilityHidden.version,
          capabilityClosed.version,
        ],
      },
      tabs: {
        twoFiles: twoFiles.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
        clicked: clicked.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
        beforeLastOpen: beforeLastOpen.length,
        lastOpen: lastOpen.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
      },
      checks,
    },
    null,
    2,
  ),
);

const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(
  "OK: the app's own open puts a real editing surface in the region's group (real text, painted, one body per region), a tab click brings it back, a second region is a second group, and close/reopen builds a fresh surface.",
);
