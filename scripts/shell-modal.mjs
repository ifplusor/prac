/**
 * The one page-side accommodation every live gate needs, whichever half it tests.
 *
 * DSH shows a **full-page notice** on the first load of a version ("Preview Notice"), and
 * it takes the page over: the notice renders in its own body root above the app behind a
 * mask, and the app root is marked **`inert`** — so prac's whole interface is neither
 * clickable nor focusable while it is up. Measured on the real rig: `elementFromPoint`
 * returns the mask (or `body`), and Playwright reports `<body> intercepts pointer events`
 * for clicks on prac's own chrome; `#root` carries `inert="true"`.
 *
 * A gate is not the notice's audience, and neither belongs in a gate: **acknowledging it is
 * a durable host setting** — the person's own onboarding step — so a gate that clicked
 * "Continue" would change their DSH state. Instead the notice's root is hidden and the
 * `inert` flag is cleared for the duration of the run.
 *
 * The root test is deliberately narrow, so nothing of the app is ever touched: a body child
 * that is not the app root, carries a mask element, and covers the viewport.
 *
 * No imports here: both gate families use it (`vendor/vscode/scripts/deep-dom.mjs` for the
 * upstream-side gates, `tests/gates/harness.mjs` for prac's own), and prac's harness
 * deliberately does not borrow the upstream checkout's toolchain.
 *
 * @module prac/scripts/shell-modal
 */

/** Page-side source. A string: Playwright serializes functions, not closures. */
export const SHELL_MODAL_SCRIPT = `(() => {
  globalThis.__pracHideShellModals = () => {
    for (const child of document.body.children) {
      if (child.tagName === "SCRIPT") continue;
      if (typeof child.querySelector !== "function") continue;
      if (child.inert === true) child.inert = false;
      if (child.id === "root") continue;
      if (child.querySelector('[class*="_mask_"]') === null) continue;
      const box = child.getBoundingClientRect();
      if (box.width < innerWidth * 0.9 || box.height < innerHeight * 0.9) continue;
      if (child.style.display !== "none") child.style.display = "none";
    }
  };
  setInterval(globalThis.__pracHideShellModals, 400);
})()`;

/**
 * Install the accommodation on a page.
 *
 * Registered as an init script as well as evaluated now, so a gate that reloads the page
 * (or a fresh navigation) is covered too.
 *
 * @param page - the Playwright page.
 */
export async function installShellModalAccommodation(page) {
  await page.addInitScript(SHELL_MODAL_SCRIPT);
  await page.evaluate(SHELL_MODAL_SCRIPT);
}
