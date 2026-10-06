/**
 * Shadow-piercing DOM queries for the gates.
 *
 * The frame gives **every view its own shadow root** (see the layout-boundary
 * note), so a gate that looks at what a view painted — `.monaco-editor`, a
 * `.part`, a part host — has to look *through* roots. The gates are contract
 * consumers like any other; this module is where that consumption is spelled
 * out, rather than seven gates each growing its own walker.
 *
 * The walker is exposed as `window.__deep` with `{ one, all, hide, box, wait }`
 * and installed **after** the page has settled, so the application's own
 * `document.querySelector` calls keep their exact semantics.
 *
 * @module prac/vendor/vscode/scripts/deep-dom
 */

/** Page-side source of the walker. Kept as a string: Playwright serializes functions, not closures. */
const WALKER = `(() => {
  const roots = () => {
    const found = [document];
    for (let i = 0; i < found.length; i += 1) {
      for (const element of found[i].querySelectorAll("*")) {
        if (element.shadowRoot) found.push(element.shadowRoot);
      }
    }
    return found;
  };
  globalThis.__deep = {
    all: (selector) => roots().flatMap((root) => [...root.querySelectorAll(selector)]),
    one: (selector) => globalThis.__deep.all(selector)[0] ?? null,
    closest: (element, selector) => {
      let node = element;
      while (node) {
        const hit = node.closest?.(selector);
        if (hit) return hit;
        const root = node.getRootNode?.();
        node = root && root.host ? root.host : null;
      }
      return null;
    },
    hide: (selector, hidden) => {
      for (const element of globalThis.__deep.all(selector)) {
        element.style.visibility = hidden ? "hidden" : "";
      }
    },
  };
})()`;

/**
 * Install the walker on a page.
 *
 * Registered as an init script as well as evaluated now: a gate that reloads the
 * page (a workspace switch, a save) would otherwise lose the walker, and
 * `verify-file` does exactly that. Defining a namespaced global is inert, so the
 * init script costs the application nothing.
 *
 * @param page - the Playwright page.
 */
export async function installDeepDom(page) {
  await page.addInitScript(WALKER);
  await page.evaluate(WALKER);
}

/**
 * Wait until a selector matches, looking through shadow roots.
 *
 * @param page - the Playwright page.
 * @param selector - the selector to wait for.
 * @param timeout - how long to wait, in ms.
 */
export async function waitDeep(page, selector, timeout = 60_000) {
  await page.waitForFunction((query) => globalThis.__deep?.all(query).length > 0, selector, {
    timeout,
  });
}
