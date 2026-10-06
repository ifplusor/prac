/**
 * Per-view isolation: one shadow root per view, and everything the frame's own
 * UI needs **delivered into** that root.
 *
 * The frame owns the boundary — a view never chooses whether it is isolated —
 * so this module is about the part that is easy to get wrong: a shadow root
 * starts empty and, unlike a document, has no `head` to inherit from.
 *
 * Three things behave differently inside a root, and each is handled here:
 *
 * - **Style sheets** live in `document.head`; document rules do not apply inside
 *   a shadow tree, so every root keeps a **live copy** of them. "Live" matters
 *   because VS Code's theme sheet is rewritten *in place* on a theme switch.
 * - **Attribute-selected rules** (`[data-ds-dark-theme] …`, `.dark …`) select on
 *   an ancestor **outside** the root, which a shadow tree cannot see, so a
 *   wrapper inside the root mirrors the document's own attributes.
 * - **Custom properties need no delivery**: they inherit, and the theme
 *   presenter writes DSH's tokens as inline properties on `document.body`.
 *   (A borrowed component's variables are the *adaptor's* business — it scopes
 *   them to `:host`; see the layout-boundary note.)
 *
 * @module prac-client-ui-layout/client/isolation
 */

/** Marks a node this module copied into a root. */
const MIRROR_ATTRIBUTE = "data-prac-mirrored";
/** Marks the root-level sheet (host sizing plus content fill). */
const ROOT_STYLE_ATTRIBUTE = "data-prac-root-styles";
/** Marks the element a view's own tree is rendered into. */
const CONTENT_ATTRIBUTE = "data-prac-view-content";
/** Marks the wrapper that mirrors the document's attributes. */
const ATTRIBUTE_MIRROR = "data-prac-view-attributes";

/**
 * Root-level rules. The frame's own `[data-prac-region] > *` rules size the
 * *host*; inside the root nothing does, so this module says it again: the host
 * fills its box, and the view's tree fills the host.
 *
 * The host is also a **hard boundary**: `contain: paint` makes it the containing
 * block for absolutely *and* fixed positioned descendants and clips them to its
 * box, so a view cannot paint its own overlay outside its box. `overflow: hidden`
 * alone would not do it — a positioned descendant whose containing-block chain
 * misses the host (which none of the frame's boxes is positioned to catch) simply
 * escapes, measured: a float born in a 280px-wide view painted over the
 * neighbouring region. Anything that must appear outside a view therefore goes
 * through the frame (the float layer), not around it.
 */
const ROOT_STYLES = `
:host { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; contain: paint; }
[${ATTRIBUTE_MIRROR}] { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
[${CONTENT_ATTRIBUTE}] { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; }
[${CONTENT_ATTRIBUTE}] > * { flex: 1 1 auto; min-width: 0; min-height: 0; pointer-events: auto; }
`;

/** Every root this module keeps in sync. */
const roots = new Set<ShadowRoot>();
/** The head/attribute observers, installed on first use. */
let observers: MutationObserver[] | undefined;
/** Whether a sync is already queued for this task. */
let queued = false;

/** The head nodes a root mirrors, in document order. */
function sources(): readonly Element[] {
  return [...document.head.querySelectorAll("style, link[rel=stylesheet]")];
}

/**
 * Queue one sync pass for every root.
 *
 * Syncing is coalesced: a theme switch rewrites one sheet's text and a bundle
 * start inserts several at once, and both should cost one pass.
 */
function schedule(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const root of roots) syncRoot(root);
  });
}

/** Install the observers that keep roots current (once per page). */
function observe(): void {
  if (observers) return;
  const head = new MutationObserver(() => schedule());
  head.observe(document.head, { childList: true, subtree: true, characterData: true });
  const attributes = new MutationObserver(() => schedule());
  for (const element of [document.documentElement, document.body]) {
    attributes.observe(element, { attributes: true });
  }
  observers = [head, attributes];
  // The presenter's first write and the bundles' first sheets can both land
  // before a root exists; syncing on install keeps the first paint correct.
  schedule();
}

/** Copy the document's own attributes onto the in-root wrapper. */
function mirrorAttributes(wrapper: Element): void {
  for (const element of [document.documentElement, document.body]) {
    for (let i = wrapper.attributes.length - 1; i >= 0; i -= 1) {
      const name = wrapper.attributes[i]?.name;
      if (name && name !== ATTRIBUTE_MIRROR && !element.hasAttribute(name)) {
        wrapper.removeAttribute(name);
      }
    }
    for (let i = 0; i < element.attributes.length; i += 1) {
      const attribute = element.attributes[i];
      if (!attribute || attribute.name === "style") continue;
      if (wrapper.getAttribute(attribute.name) !== attribute.value) {
        wrapper.setAttribute(attribute.name, attribute.value);
      }
    }
  }
}

/** Bring one root's mirrored sheets and attributes up to date. */
function syncRoot(root: ShadowRoot): void {
  if (!root.host.isConnected) {
    roots.delete(root);
    return;
  }
  let style = root.querySelector<HTMLStyleElement>(`style[${ROOT_STYLE_ATTRIBUTE}]`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute(ROOT_STYLE_ATTRIBUTE, "");
    style.textContent = ROOT_STYLES;
    root.prepend(style);
  }
  for (const node of root.querySelectorAll(`[${MIRROR_ATTRIBUTE}]`)) node.remove();
  for (const source of sources()) {
    const copy = source.cloneNode(true) as Element;
    copy.setAttribute(MIRROR_ATTRIBUTE, "");
    root.insertBefore(copy, style);
  }
  const wrapper = root.querySelector(`[${ATTRIBUTE_MIRROR}]`);
  if (wrapper) mirrorAttributes(wrapper);
}

/**
 * Give a host element its isolation boundary and return the element a view's
 * tree renders into.
 *
 * Idempotent per host: calling it again returns the same content element, so a
 * remount (or a second render) does not build a second root.
 *
 * @param host - the element the frame gives the view (its light-DOM box).
 * @returns the element to render the view's tree into.
 */
export function mountIsolated(host: HTMLElement): HTMLElement {
  observe();
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  roots.add(root);
  let wrapper = root.querySelector<HTMLElement>(`[${ATTRIBUTE_MIRROR}]`);
  if (!wrapper) {
    wrapper = document.createElement("div");
    wrapper.setAttribute(ATTRIBUTE_MIRROR, "");
    root.append(wrapper);
  }
  let content = root.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`);
  if (!content) {
    content = document.createElement("div");
    content.setAttribute(CONTENT_ATTRIBUTE, "");
    wrapper.append(content);
  }
  syncRoot(root);
  return content;
}

/**
 * Drop a host's root from the sync set.
 *
 * The DOM is left alone: React removes the host, and with it the root.
 *
 * @param host - the host whose root no longer needs syncing.
 */
export function releaseIsolated(host: HTMLElement): void {
  const root = host.shadowRoot;
  if (root) roots.delete(root);
}
