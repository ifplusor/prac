/**
 * Wait until a page predicate holds, twice in a row.
 *
 * This is the gate author's waiting primitive: a gate waits on the **state the
 * assertion is about** (the frame's items, a capability snapshot, a stable DOM
 * shape) and lets the check fail if it never arrives. A single sample is not
 * enough — a surface can be present for one frame and move as the layout
 * settles, and a click then lands on the stale box.
 *
 * A miss falls through to the checks rather than throwing, so the gate reports
 * which fact was wrong instead of a 30-second timeout.
 *
 * Dependency-free on purpose: the vendor gates import Playwright from their own
 * copy, and loading the harness there pulls a second one.
 *
 * @param {import("playwright").Page} page - the gate's page.
 * @param {(arg: unknown) => unknown} predicate - evaluated in the page.
 * @param {unknown} [arg] - one argument for the predicate.
 * @param {{ timeout?: number, interval?: number }} [options] - bound and poll gap.
 * @returns {Promise<boolean>} whether the condition held twice before the bound.
 */
export async function until(page, predicate, arg, options = {}) {
  const { timeout = 5000, interval = 100 } = options;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(predicate, arg)) {
        await page.waitForTimeout(interval);
        if (await page.evaluate(predicate, arg)) return true;
      }
    } catch {
      // The page can be mid-navigation; poll again.
    }
    await page.waitForTimeout(interval);
  }
  return false;
}

/**
 * Wait until a view's window-action model is published.
 *
 * The model is the state (the strip renders from it); waiting on the rendered
 * buttons instead would measure React's commit timing, and in a slow order that
 * is the flake. Resolves `false` when the bound passes or the probe is absent.
 *
 * @param {import("playwright").Page} page - the gate's page.
 * @param {string} view - the view id whose actions to wait for.
 * @param {{ timeout?: number }} [options] - bound in ms.
 * @returns {Promise<boolean>} whether the model was published before the bound.
 */
export function windowActionsReady(page, view, { timeout = 5000 } = {}) {
  return page.evaluate(
    ({ view: id, timeout: bound }) =>
      new Promise((resolve) => {
        const face = globalThis.__pracWindowActions;
        if (face === undefined) return resolve(false);
        const ready = () => face.get(id) !== undefined;
        if (ready()) return resolve(true);
        const timer = setTimeout(() => {
          stop();
          resolve(false);
        }, bound);
        const stop = face.subscribe(() => {
          if (!ready()) return;
          clearTimeout(timer);
          stop();
          resolve(true);
        });
      }),
    { view, timeout },
  );
}
