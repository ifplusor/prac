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
 * The same install also puts prac's **view-id helpers** in the page
 * (`__pracFileViews`, `__pracFileView`, `__pracFileResource`): a gate that has a
 * fixture file's URI and wants the view standing for it must read that from the live
 * layout rather than spell the id convention out. A file has one view per
 * **placement** (a file in one of the app's editor groups), so the id carries the
 * group — and a gate that rebuilds `vscode:file:<uri>` is asserting against a shape
 * that is not what the app produces.
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
  // Every prac view standing for one file, in layout order: one per **placement**
  // (the same file open in two editor groups is two views).
  globalThis.__pracFileViews = (resource) =>
    (globalThis.__pracLayout?.listViews() ?? [])
      .map((view) => view.id)
      .filter((id) => id.startsWith("vscode:file:") && id.endsWith(resource));
  globalThis.__pracFileView = (resource) => globalThis.__pracFileViews(resource)[0] ?? null;
  // The file behind a view id: the id is vscode:file:<placement>:<resource>, and a
  // placement token is p<digits> (which no URI scheme looks like).
  globalThis.__pracFileResource = (view) =>
    String(view)
      .replace(/^vscode:file:/, "")
      .replace(/^p\\d+:/, "");
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

/**
 * The file behind a prac file-view id — the gate-side half of `__pracFileResource`.
 *
 * An assertion written in Node (a `checks` object) cannot call the page's helpers, so
 * the one rule the id carries is spelled twice: here and in the walker. It is one
 * `replace`, and the alternative — a gate that rebuilds the id — is what made the
 * placement change look like a regression.
 *
 * @param view - a `vscode:file:…` view id.
 * @returns the file's URI.
 */
export function resourceOfFileView(view) {
  return String(view)
    .replace(/^vscode:file:/, "")
    .replace(/^p\d+:/, "");
}
