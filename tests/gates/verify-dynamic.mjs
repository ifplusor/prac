/**
 * Verification of **dynamic view contribution**.
 *
 * A view can enter and leave the app catalogue without a page reload; the frame
 * and `vscode-host` must materialize it, place it, mount its host, and then clean
 * all of that up when it disappears. The fixture extension contributes
 * `pracGateView` with `when: "pracGateVisible"` and a command that flips that
 * context; this gate drives the command, not the extension manager.
 *
 * Prerequisite: the fixture at `tests/fixtures/dynamic-extension` must be in the
 * rig's extensions directory (the dynamic rig uses a temporary
 * `XDG_DATA_HOME`), and the extension must be activated.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);
await page.waitForFunction(() => globalThis.__pracVscodeFace !== undefined, null, {
  timeout: 30_000,
});
// The fixture's command is registered when its extension activates; give the
// extension host a beat after the face appears.
await page.waitForTimeout(3000);
const VIEW = "vscode:view:pracGateView";
const APP_VIEW = "pracGateView";

/** Read the catalogue and the boards that own the fixture's view. */
const state = () =>
  page.evaluate(
    ({ view, appView }) => {
      // The host mounts inside the container board window's isolation root.
      const deepHosts = () => {
        let count = 0;
        const walk = (root) => {
          for (const element of root.querySelectorAll("*")) {
            if (element.shadowRoot) {
              count += element.shadowRoot.querySelectorAll(`[data-vscode-embed-view="${appView}"]`).length;
              walk(element.shadowRoot);
            }
          }
        };
        count += document.querySelectorAll(`[data-vscode-embed-view="${appView}"]`).length;
        walk(document);
        return count;
      };
      const boards = (globalThis.__pracWidgets?.boards?.() ?? []).map((board) => ({
        id: board.id,
        widgets:
          typeof board.widgetOrder === "function" ? [...board.widgetOrder()] : [],
      }));
      return {
        catalogue: globalThis.__pracVscodeFace
          ?.catalogue()
          .filter((entry) => entry.view === view || entry.appId === appView),
        frames: globalThis.__pracFrame?.listItems().filter((entry) => entry.id === view) ?? [],
        boards,
        owners: boards.filter((board) => board.widgets.includes(view)).map((board) => board.id),
        hosts: deepHosts(),
      };
    },
    { view: VIEW, appView: APP_VIEW },
  );

/** Poll the page state from Node until a condition holds. */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const current = await state();
    if (predicate(current)) return current;
    await page.waitForTimeout(250);
  }
  throw new Error("timed out waiting for the dynamic view state");
}

/** Invoke the fixture command; the gate's only control surface. */
const run = (command) =>
  page.evaluate(async (name) => {
    const face = globalThis.__pracVscodeFace;
    if (face === undefined) throw new Error("pracVscode face is not published");
    await face.runCommand(name);
  }, command);

const before = await state();
await run("prac.gate.show");
await waitFor((current) => current.catalogue.length === 1);
await page.evaluate((view) => globalThis.__pracFrame?.setFront(view), VIEW);
await page.evaluate(() =>
  document.querySelector('[data-prac-container="left/container:workbench.view.explorer"]')?.click(),
);
await page.waitForTimeout(1200);
const shown = await state();

await run("prac.gate.hide");
const hidden = await waitFor((current) => current.catalogue.length === 0);
await page.waitForTimeout(800);

await run("prac.gate.show");
const shownAgain = await waitFor((current) => current.catalogue.length === 1);
await page.waitForTimeout(800);

await close();

const facts = { before, shown, hidden, shownAgain };
report({
  url,
  facts,
  checks: {
    "the fixture view starts absent": before.catalogue.length === 0 && before.frames.length === 0,
    "the view enters the catalogue": shown.catalogue.length === 1,
    "the view materializes on a board window": shown.owners.length === 1,
    "the view leaves the catalogue": hidden.catalogue.length === 0,
    "the view is removed from the board": hidden.owners.length === 0,
    "the host is released": hidden.hosts === 0,
    "the view returns": shownAgain.catalogue.length === 1 && shownAgain.owners.length === 1,
    "no prac-owned console errors":
      own("__pracFrame").length === 0 && own("vscode-embed:").length === 0,
  },
  ok: "OK: a contributed view enters and leaves the catalogue without a reload; its frame placement follows.",
});
