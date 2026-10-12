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
 *   The copy is made **once per source** and refreshed only when that source
 *   actually changed: a sync that re-clones every sheet costs a re-parse of the
 *   whole shell CSS in every root, which a person sees as every pane flashing —
 *   measured, one opened file re-created 672 `<style>` nodes in a single root,
 *   and the sync runs on every mount and every render of a view host.
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

/** One mirrored source and the node that stands for it inside a root. */
interface Mirror {
  readonly source: Element;
  readonly node: Element;
  /** The source's revision when `node` was last copied from it. */
  revision: number;
}

/** Every root this module keeps in sync. */
const roots = new Set<ShadowRoot>();
/** What each root currently mirrors, in source order. */
const mirrors = new WeakMap<ShadowRoot, Mirror[]>();
/** How many times a source's own content changed (see {@link bumpRevision}). */
const revisions = new WeakMap<Element, number>();
/** The head/attribute observers, installed on first use. */
let observers: MutationObserver[] | undefined;
/** Whether a sync is already queued for this task. */
let queued = false;

/** The head nodes a root mirrors, in document order. */
function sources(): readonly Element[] {
  return [...document.head.querySelectorAll("style, link[rel=stylesheet]")];
}

/** A source's content revision; a mirror holding this number is current. */
function revisionOf(source: Element): number {
  return revisions.get(source) ?? 0;
}

/**
 * Note that one source's content changed.
 *
 * A `<style>` element is rewritten **in place** (VS Code's theme swap does exactly that), so
 * the mutation's target is a text node or the element itself rather than a new element: the
 * revision is what lets a sync refresh that one copy instead of re-cloning everything.
 *
 * @param target - the mutation's target.
 */
function bumpRevision(target: Node): void {
  const element =
    target.nodeType === 1 ? (target as Element) : (target.parentElement as Element | null);
  if (element !== null && element !== undefined) {
    revisions.set(element, revisionOf(element) + 1);
  }
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
  const head = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.addedNodes) bumpRevision(node);
        for (const node of record.removedNodes) bumpRevision(node);
      } else {
        bumpRevision(record.target);
      }
    }
    schedule();
  });
  head.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
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

/** The root's own size/fill sheet, made once. */
function rootStyle(root: ShadowRoot): HTMLStyleElement {
  const existing = root.querySelector<HTMLStyleElement>(`style[${ROOT_STYLE_ATTRIBUTE}]`);
  if (existing !== null) return existing;
  const style = document.createElement("style");
  style.setAttribute(ROOT_STYLE_ATTRIBUTE, "");
  style.textContent = ROOT_STYLES;
  root.prepend(style);
  return style;
}

/** Refresh one copy from its source, when the source's revision moved on. */
function refresh(mirror: Mirror): void {
  const revision = revisionOf(mirror.source);
  if (mirror.revision === revision) return;
  mirror.revision = revision;
  // The copy's own marker attribute is ours; everything else comes from the source.
  const wanted = [...mirror.source.attributes].filter(
    (attribute) => attribute.name !== MIRROR_ATTRIBUTE,
  );
  for (let i = mirror.node.attributes.length - 1; i >= 0; i -= 1) {
    const name = mirror.node.attributes[i]?.name;
    if (name !== undefined && name !== MIRROR_ATTRIBUTE && !wanted.some((a) => a.name === name)) {
      mirror.node.removeAttribute(name);
    }
  }
  for (const attribute of wanted) mirror.node.setAttribute(attribute.name, attribute.value);
  if (mirror.node.textContent !== mirror.source.textContent) {
    mirror.node.textContent = mirror.source.textContent;
  }
}

/** Bring one root's mirrored sheets and attributes up to date. */
function syncRoot(root: ShadowRoot): void {
  if (!root.host.isConnected) {
    roots.delete(root);
    return;
  }
  rootStyle(root);
  const previous = mirrors.get(root) ?? [];
  const next: Mirror[] = [];
  for (const source of sources()) {
    const held = previous.find((mirror) => mirror.source === source);
    if (held === undefined) {
      const node = source.cloneNode(true) as Element;
      node.setAttribute(MIRROR_ATTRIBUTE, "");
      next.push({ source, node, revision: revisionOf(source) });
    } else {
      refresh(held);
      next.push(held);
    }
  }
  // Reconcile **in place**: move a node only when it is not already where it belongs, and
  // remove only the ones that are gone. Re-inserting a sheet re-applies it, which is the
  // flash this pass exists to avoid.
  const kept = new Set(next.map((mirror) => mirror.node));
  for (const mirror of previous) {
    if (!kept.has(mirror.node)) mirror.node.remove();
  }
  let cursor: Node | null = root.firstChild;
  for (const mirror of next) {
    if (mirror.node !== cursor) root.insertBefore(mirror.node, cursor);
    cursor = mirror.node.nextSibling;
  }
  mirrors.set(root, next);
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
