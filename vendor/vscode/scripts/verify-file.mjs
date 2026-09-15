/**
 * Verification of **file-level** hosting (decision 17's vendor half): one file's
 * editing surface, outside the editor part.
 *
 * The unit is the file, because prac owns which files are open, how they are
 * grouped and the tab strip. What this gate refuses to take on faith:
 *
 *  1. **a real editing surface** — the workbench's own text model for the file
 *     in a `CodeEditorWidget`: the rendered lines are that file's text, and the
 *     expectation is read from the same file on disk rather than hard-coded (the
 *     app's workspace is DSH's active workspace, not this repository);
 *  2. **paint** — a structurally present, visually blank editor is the failure
 *     mode that looks healthy in the DOM;
 *  3. **one surface per file** — mounting the same resource again is the same
 *     editor re-parented (a second one would be a second view of one model),
 *     while a different file is a different editor;
 *  4. **release + recreate** — the surface disposes so the same file can be
 *     mounted again, and a failed mount is reported rather than thrown at the
 *     embedder.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' node scripts/verify-file.mjs
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"));
const upstreamDir = join(workDir, "upstream");
const url = process.env.URL;

if (!url) throw new Error('URL is required, e.g. URL="http://127.0.0.1:3084/?token=..."');
if (!existsSync(join(upstreamDir, "node_modules/@playwright/test"))) {
  throw new Error(
    "@playwright/test is not installed in the upstream checkout; run vscode:build first",
  );
}

const require = createRequire(join(upstreamDir, "package.json"));
const { chromium } = require("@playwright/test");

/**
 * The local path behind a workbench folder URI.
 *
 * The app's folders are `vscode-remote://<authority>/<path>`; the authority is
 * the page that serves the remote, so the path is what the local file system
 * has. Kept as a string strip rather than `new URL` because `vscode-remote` is
 * not a special scheme.
 *
 * @param folder - the folder URI as the workbench reports it.
 */
const localPathOf = (folder) =>
  decodeURIComponent(folder.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, ""));

/**
 * Pick two files that exist in the workspace, with a marker the editor must show.
 *
 * `package.json` gives an exact JSON line; the second file gives its first
 * substantial line. Both come from the files on disk, so the gate works in
 * whichever folder the app is bound to.
 *
 * @param root - the workspace folder's local path.
 */
function pickFiles(root) {
  const manifest = join(root, "package.json");
  const name = JSON.parse(readFileSync(manifest, "utf8")).name;
  const first = { path: "package.json", marker: `"name": "${name}"` };
  const extra = [];
  for (const candidate of ["README.md", "AGENTS.md", "tsconfig.json"]) {
    const full = join(root, candidate);
    if (!existsSync(full)) continue;
    const line = readFileSync(full, "utf8")
      .split("\n")
      .map((text) => text.trim())
      .find((text) => text.length >= 16);
    if (line === undefined) continue;
    extra.push({ path: candidate, marker: line.slice(0, 30) });
  }
  if (extra.length < 3) throw new Error(`need three more files with marker lines in ${root}`);
  // Two roles, and they must not overlap: the probe hosts hold one pair, the app
  // opens the other. A resource has exactly **one** editing surface (decision 17),
  // so mounting a file the frame also shows makes the two fight over it — measured:
  // releasing a probe mount took the editor out of the frame's view, and nothing
  // re-created it while that view stayed mounted.
  return { probe: [first, extra[0]], app: [extra[1], extra[2]] };
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
// The face is published from inside the workbench, once its service graph has
// restored — that is the whole point of the bridge's direction.
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
const folder = await page.evaluate(
  () => (globalThis.__vscodeEmbed.face.workspaceInfo().folders ?? [])[0] ?? null,
);
if (!folder) throw new Error("the workbench has no workspace folder");
const { probe: PROBE, app: APP } = pickFiles(localPathOf(folder));
/** The probe hosts' files: the app never opens these. */
const [PROBE_A, PROBE_B] = PROBE;
/** The app's files: the frame shows their surfaces, the probes never touch them. */
const [APP_A, APP_B] = APP;

// Two host elements the embedder renders for two files, plus a third used for
// the same-file-twice and release/recreate phases.
await page.evaluate(
  ({ first, second }) => {
    const face = globalThis.__vscodeEmbed.face;
    const folder = (face.workspaceInfo().folders ?? [])[0];
    if (!folder) throw new Error("the workbench has no workspace folder");
    const host = (id) => {
      const element = document.createElement("div");
      element.id = id;
      element.style.cssText =
        "position:fixed;z-index:99999;width:620px;height:360px;left:20px;background:#1e1e1e";
      element.style.top = id === "prac-file-a" ? "20px" : id === "prac-file-b" ? "400px" : "780px";
      document.body.append(element);
      return element;
    };
    globalThis.__pracFileProbe = { folder };
    face.mountFileInto(`${folder}/${first.path}`, host("prac-file-a"));
    face.mountFileInto(`${folder}/${second.path}`, host("prac-file-b"));
  },
  { first: PROBE_A, second: PROBE_B },
);
await page.waitForSelector("#prac-file-a .monaco-editor", { timeout: 60_000 });
await page.waitForSelector("#prac-file-b .monaco-editor", { timeout: 60_000 });
await page.waitForTimeout(2000);

/** One host's structure, rendered text, paint and editor identity. */
async function sample() {
  const facts = await page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    };
    const read = (id) => {
      const element = document.getElementById(id);
      // Monaco renders text with non-breaking spaces; normalise before matching.
      const text = (element?.querySelector(".view-lines")?.textContent ?? "").replace(
        /\u00a0/g,
        " ",
      );
      return {
        host: box(element),
        editors: element?.querySelectorAll(".monaco-editor").length ?? 0,
        lines: element?.querySelectorAll(".view-line").length ?? 0,
        text: text.slice(0, 4000),
      };
    };
    return {
      first: read("prac-file-a"),
      second: read("prac-file-b"),
      third: read("prac-file-c"),
      mountErrors: [],
    };
  });
  for (const key of ["first", "second"]) {
    const host = facts[key].host;
    if (host && host.w > 2 && host.h > 2) {
      const shot = await page.screenshot({
        clip: { x: host.x, y: host.y, width: host.w, height: host.h },
      });
      facts[`${key}Colours`] = await page.evaluate(analyse, shot.toString("base64"));
    } else {
      facts[`${key}Colours`] = 0;
    }
  }
  const lines = consoleErrors.filter((line) => line.includes("vscode-embed"));
  facts.mountErrors = lines.length;
  facts.mountMessages = lines.map((line) => line.slice(0, 300));
  return facts;
}

const mounted = await sample();

// The same file again: the same surface, re-parented into the third host.
await page.evaluate(
  ({ first }) => {
    const face = globalThis.__vscodeEmbed.face;
    const element = document.createElement("div");
    element.id = "prac-file-c";
    element.style.cssText =
      "position:fixed;z-index:99999;width:300px;height:200px;left:700px;top:20px";
    document.body.append(element);
    face.mountFileInto(`${globalThis.__pracFileProbe.folder}/${first.path}`, element);
  },
  { first: PROBE_A },
);
await page.waitForTimeout(1200);
const remounted = await sample();

// The other direction: the app opens a file itself (an explorer click, a command,
// go-to-definition), which has to reach the embedder as an event — otherwise the
// app would be editing files nobody can see. The opener is `openFile`, the same
// editor-service call an explorer click makes.
await page.evaluate((uri) => {
  const face = globalThis.__vscodeEmbed.face;
  const events = [];
  globalThis.__openFileProbe = { events, before: face.listOpenFiles() };
  globalThis.__stopOpenFileProbe = face.onDidChangeOpenFiles(() => {
    events.push(face.listOpenFiles());
  });
  face.openFile(uri);
  // A non-file editor (an untitled buffer has a text model and no file system
  // provider) must not be offered as a file: mounting it would try to read a
  // path that cannot exist.
  face.openUntitled();
}, `${folder}/${APP_A.path}`);
await page.waitForTimeout(2500);
const opened = await page.evaluate(() => ({
  before: globalThis.__openFileProbe.before,
  events: globalThis.__openFileProbe.events,
  after: globalThis.__vscodeEmbed.face.listOpenFiles(),
}));
await page.evaluate(() => globalThis.__stopOpenFileProbe?.());

// Tabs (decision 17's stage chrome, borrowed from VS Code's editor group): the
// strip shows for a single file (`showTabs: "multiple"` is VS Code's default),
// a second file gets its own tab, and clicking a tab brings that view forward.
const tabsOf = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-prac-tab]")].map((element) => ({
      id: element.getAttribute("data-prac-tab"),
      active: element.getAttribute("data-prac-tab-active") === "true",
    })),
  );

const oneFile = await tabsOf();
// A file the probe hosts do not hold (one surface per resource), and not the one
// the event phase already opened: this brings the stage to exactly two tabs.
await page.evaluate(
  (uri) => globalThis.__vscodeEmbed.face.openFile(uri),
  `${folder}/${APP_B.path}`,
);
await page.waitForTimeout(2500);
await page.waitForFunction(() => document.querySelectorAll("[data-prac-tab]").length === 2, null, {
  timeout: 60_000,
});
await page.waitForTimeout(2500);
const twoFiles = await tabsOf();
// Click whichever tab is not active: the region must follow the click.
const inactive = twoFiles.find((tab) => !tab.active)?.id ?? null;
if (inactive === null) throw new Error("the second file did not add an inactive tab");
await page.click(`[data-prac-tab="${inactive}"]`);
await page.waitForTimeout(2000);
const clicked = await tabsOf();
// The click re-fronts prac's view; the app's active editor must follow, or the two
// disagree about which file is current (the seat reconciles through `activate`).
const activeAfterClick = await page.evaluate(
  () =>
    globalThis.__vscodeEmbed.face.capabilities.editors.snapshot().find((e) => e.active)?.resource,
);

// Release the first file, then mount it again into a fresh host.
await page.evaluate(
  ({ first }) => {
    const face = globalThis.__vscodeEmbed.face;
    const uri = `${globalThis.__pracFileProbe.folder}/${first.path}`;
    face.releaseFile(uri);
    const element = document.getElementById("prac-file-a");
    if (element) element.replaceChildren();
    face.mountFileInto(uri, element);
  },
  { first: PROBE_A },
);
await page.waitForSelector("#prac-file-a .monaco-editor", { timeout: 60_000 });
await page.waitForTimeout(1500);
const released = await sample();

// Decision 21's first capability: the open editor set, addressed by name rather
// than by whichever view happens to be mounted.
const capability = () =>
  page.evaluate(() => {
    const editors = globalThis.__vscodeEmbed.face.capabilities.editors;
    // The chrome the seat pushes from this capability: a tab's dot.
    const tabs = [...document.querySelectorAll("[data-prac-tab]")].map((element) => ({
      resource: element.getAttribute("data-prac-tab")?.replace(/^vscode:file:/, "") ?? null,
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

const capabilityBefore = await capability();
const activeResource = capabilityBefore.snapshot.find((entry) => entry.active)?.resource ?? null;
if (activeResource === null) throw new Error("no active editor to exercise the capability with");
// Bring that file's view to the front (what clicking its prac tab does), which
// mounts its surface — then tell the app the same thing through the capability's
// `activate`. Both halves matter: prac's front view and the app's active editor are
// two states, and the UI keeps them in step through this action.
await page.evaluate(
  (view) => globalThis.__pracLayout.place(view, "stage"),
  `vscode:file:${activeResource}`,
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
    [...document.querySelectorAll("[data-vscode-embed-file]")]
      .find((element) => element.querySelector(".view-lines"))
      ?.getAttribute("data-vscode-embed-file") ?? null,
);
if (surfaceResource === null) {
  const dump = await page.evaluate(() => ({
    hosts: [...document.querySelectorAll("[data-vscode-embed-file]")].map((element) => ({
      file: element.getAttribute("data-vscode-embed-file")?.split("/").pop(),
      inRegion: element.closest("[data-prac-region]")?.getAttribute("data-prac-region") ?? null,
      children: element.children.length,
      monaco: element.querySelectorAll(".monaco-editor").length,
    })),
    records: Object.entries(globalThis.__pracLayout.getState().views)
      .filter(([id]) => id.startsWith("vscode:file:"))
      .map(([id, view]) => `${id.split("/").pop()}@${view.region}${view.hidden ? "(hidden)" : ""}`),
    open: globalThis.__vscodeEmbed.face.listOpenFiles().map((r) => r.split("/").pop()),
    tabs: [...document.querySelectorAll("[data-prac-tab]")].map((e) =>
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
await page.evaluate((view) => globalThis.__pracLayout.hide(view), `vscode:file:${surfaceResource}`);
await page.waitForTimeout(1500);
const capabilityHidden = await capability();
// Closing the editor is an action of the capability, and the view follows.
await page.evaluate(
  (resource) => globalThis.__vscodeEmbed.face.capabilities.editors.actions.close(resource),
  surfaceResource,
);
await page.waitForTimeout(2500);
const capabilityClosed = await capability();

// A reload forgets the app's editors, and the frame must forget the views with
// them: a persisted placement record outlives the file, and left alone it renders
// a tab for a file nobody has open and holds the centre with an empty view.
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-prac-frame]", { timeout: 60_000 });
await page.waitForFunction(() => !!globalThis.__vscodeEmbed?.face, null, { timeout: 60_000 });
await page.waitForTimeout(6000);
const reloaded = await page.evaluate(() => ({
  open: globalThis.__vscodeEmbed.face.listOpenFiles(),
  fileHosts: document.querySelectorAll("[data-vscode-embed-file]").length,
  fileTabs: [...document.querySelectorAll("[data-prac-tab]")]
    .map((element) => element.getAttribute("data-prac-tab"))
    .filter((id) => id !== null && id.startsWith("vscode:file:")),
  conversationRegion:
    globalThis.__pracLayout.getState().views["dsh:main:conversation"]?.region ?? null,
}));

await browser.close();

const painted = (colours) => typeof colours === "number" && colours > 4;
const checks = {
  // 1. Real editing surfaces: the workbench's model, rendered as lines of text.
  bothFilesMounted: mounted.first.editors === 1 && mounted.second.editors === 1,
  firstShowsItsOwnText: mounted.first.lines > 3 && mounted.first.text.includes(PROBE_A.marker),
  secondShowsItsOwnText: mounted.second.lines > 3 && mounted.second.text.includes(PROBE_B.marker),
  // 2. Paint, because present-but-blank is the failure mode.
  bothFilesPainted: painted(mounted.firstColours) && painted(mounted.secondColours),
  // 3. One surface per file: the third mount is the same editor, re-parented.
  sameFileIsOneSurface:
    remounted.third.editors === 1 &&
    remounted.first.editors === 0 &&
    remounted.second.editors === 1,
  // 4. Release disposes, and the same file can be mounted again.
  releaseThenRemount:
    released.first.editors === 1 && released.first.lines > 3 && released.second.editors === 1,
  // 5. The app's own openings reach the embedder: a new resource in the list and
  // an event carrying it.
  appOpeningIsReported:
    opened.after.length === opened.before.length + 1 &&
    opened.after.some((resource) => !opened.before.includes(resource)),
  appOpeningFiresTheEvent:
    opened.events.length >= 1 &&
    opened.events[opened.events.length - 1].some((resource) => !opened.before.includes(resource)),
  // …and only files: the untitled buffer opened in the same breath is not one.
  nonFilesAreNotOffered: opened.after.every((resource) => !resource.startsWith("untitled:")),
  // 6. Tabs: VS Code's default visibility, one per file, and the click switches.
  stripShownForOneFile: oneFile.length === 1 && oneFile[0].active,
  twoFilesTwoTabs: twoFiles.length === 2 && twoFiles.filter((tab) => tab.active).length === 1,
  newestFileIsActive: twoFiles.find((tab) => tab.active)?.id.endsWith(APP_B.path) === true,
  clickBringsItForward:
    clicked.length === 2 &&
    clicked.find((tab) => tab.active)?.id === inactive &&
    clicked.filter((tab) => tab.active).length === 1,
  // 8. The capability: one handle for both consumers, and no UI required.
  capabilityUndoesChanges: capabilityUndone.snapshot.some(
    (entry) => entry.resource === surfaceResource && !entry.dirty,
  ),
  tabMarksUnsavedChanges:
    capabilityDirty.tabs.some((tab) => tab.resource === surfaceResource && tab.dirty) &&
    capabilityBefore.tabs.some((tab) => tab.resource === surfaceResource && !tab.dirty),
  tabClearsTheMarkOnUndo: capabilityUndone.tabs.some(
    (tab) => tab.resource === surfaceResource && !tab.dirty,
  ),
  clickedTabIsTheAppsActiveEditor:
    activeAfterClick === clicked.find((tab) => tab.active)?.id.replace(/^vscode:file:/, ""),
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
  // 7. A reload takes the files with it — and takes their views with them.
  reloadForgetsTheFiles: reloaded.open.length === 0 && reloaded.fileHosts === 0,
  noTabForAClosedFile: reloaded.fileTabs.length === 0,
  conversationTakesTheCentreBack: reloaded.conversationRegion === "stage",
  // A failed mount is logged by the composition, not thrown at the embedder.
  noMountErrors:
    mounted.mountErrors === 0 && remounted.mountErrors === 0 && released.mountErrors === 0,
};

console.log(
  JSON.stringify(
    {
      url,
      workspace: {
        folder,
        probeFiles: PROBE.map((file) => file.path),
        appFiles: APP.map((file) => file.path),
        markers: PROBE.map((file) => file.marker),
      },
      mounted: {
        first: { ...mounted.first, text: undefined },
        second: { ...mounted.second, text: undefined },
        firstColours: mounted.firstColours,
        secondColours: mounted.secondColours,
        mountMessages: mounted.mountMessages,
      },
      remounted: {
        first: { ...remounted.first, text: undefined },
        third: { ...remounted.third, text: undefined },
        mountMessages: remounted.mountMessages,
      },
      released: {
        first: { ...released.first, text: undefined },
        mountMessages: released.mountMessages,
      },
      opened: { before: opened.before, after: opened.after, eventCount: opened.events.length },
      reloaded,
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
        oneFile: oneFile.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
        twoFiles: twoFiles.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
        clicked: clicked.map((tab) => (tab.active ? `${tab.id} (active)` : tab.id)),
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
  "OK: a file mounts as its own editing surface (real text, painted), the same file is one surface re-parented, and release lets it be mounted again.",
);
