/**
 * One phase of the **extension lifecycle** acceptance. `verify:ui` owns the
 * filesystem and rig restarts; this gate only reads the current phase:
 *
 *  - `PHASE=absent`   — the fixture directory is gone; no view/placement.
 *  - `PHASE=restored` — the fixture is back; show it and assert the view/placement.
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const phase = process.env.PHASE ?? "restored";
const VIEW = "vscode:view:pracGateView";

const url = requireUrl();
const { page, close } = await openPrac(url);
await page.waitForFunction(() => globalThis.__pracVscodeFace !== undefined, null, {
  timeout: 30_000,
});
await page.waitForTimeout(2500);

const state = () =>
  page.evaluate(
    ({ view }) => ({
      catalogue:
        globalThis.__pracVscodeFace?.catalogue().filter((entry) => entry.view === view) ?? [],
      frames: globalThis.__pracLayout?.listViews().filter((entry) => entry.id === view) ?? [],
      hosts: document.querySelectorAll(`[data-prac-view-host][data-prac-view-id="${view}"]`).length,
    }),
    { view: VIEW },
  );

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate(await state())) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out; last state: ${JSON.stringify(await state())}`);
}

async function activateView() {
  await page.click(
    '[data-prac-container-bar="left"] [data-prac-container="left/container:workbench.view.explorer"]',
  );
  await page.evaluate((view) => globalThis.__pracLayout.setFront(view), VIEW);
  await page.waitForTimeout(1200);
}

async function command(id) {
  let last;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await page.evaluate(async (commandId) => {
        await globalThis.__pracVscodeFace.runCommand(commandId);
      }, id);
      return;
    } catch (cause) {
      last = cause;
      await page.waitForTimeout(250);
    }
  }
  throw last;
}

let facts;
if (phase === "absent") {
  await waitFor((value) => value.catalogue.length === 0 && value.frames.length === 0);
  facts = await state();
} else {
  await command("prac.gate.show");
  await activateView();
  await waitFor(
    (value) => value.catalogue.length === 1 && value.frames.length === 1 && value.hosts > 0,
  );
  facts = await state();
}

await close();
report({
  url,
  facts: { phase, ...facts },
  checks:
    phase === "absent"
      ? {
          "the view is absent from the catalogue": facts.catalogue.length === 0,
          "the view has no frame placement": facts.frames.length === 0,
          "the view has no mounted host": facts.hosts === 0,
        }
      : {
          "the reinstalled extension contributes the view": facts.catalogue.length === 1,
          "the reinstalled view is placed in the frame": facts.frames.length === 1,
          "the reinstalled view mounts a host": facts.hosts > 0,
        },
  ok:
    phase === "absent"
      ? "OK: with the extension removed, the view is absent from catalogue and frame."
      : "OK: after reinstalling the extension and restarting the rig, the view is back and mounted.",
});
