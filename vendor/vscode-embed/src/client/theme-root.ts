/**
 * Deliver the app's theme variables into an isolation root.
 *
 * With every view in its own shadow root, two things that used to "just work"
 * stop working, and only the second one needs this module:
 *
 * - the app's **rules** are document sheets, and document rules do not apply
 *   inside a shadow tree — the frame already mirrors them into every root;
 * - the app's **theme** is one rule (`.monaco-workbench { --vscode-*: … }`) and
 *   custom properties only inherit from ancestors. Declaring them on the root's
 *   host (`:host`) hands them to everything inside.
 *
 * `:host` is doing real work here: a `monaco-workbench` wrapper inside the root
 * would also resolve the variables, but it wakes the whole workbench-scoped
 * cascade and the picture changes (measured: every pixel of the view changed).
 *
 * The declarations are **not copied once**: the app rewrites the theme sheet in
 * place when the theme changes, so this keeps the root's copy in sync by
 * observing the head (measured: a one-time copy goes stale).
 *
 * @module prac-vscode-embed/client/theme-root
 */

/** Marks the sheet this module owns inside a root. */
const ROOT_THEME_ATTRIBUTE = "data-vscode-embed-theme";

/** The style element the app writes its colour theme into, when it is named. */
const THEME_SHEET_CLASS = "contributedColorTheme";

/**
 * The declarations of the app's theme rule (`.monaco-workbench { --vscode-* }`).
 *
 * Read through CSSOM rather than by parsing text: the rule is regenerated
 * wholesale on every theme change, and the named sheet is the one the app
 * itself treats as the theme.
 *
 * @returns the declaration block, or an empty string before a theme exists.
 */
function themeDeclarations(): string {
  const sheets = [...document.querySelectorAll("style")];
  const named = sheets.filter((sheet) => sheet.classList.contains(THEME_SHEET_CLASS));
  const candidates = [...named, ...sheets.filter((sheet) => !named.includes(sheet))];
  let best = "";
  for (const element of candidates) {
    const sheet = element.sheet;
    if (!sheet) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // A cross-origin sheet; nothing readable there.
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText !== ".monaco-workbench") continue;
      const declarations = rule.style.cssText;
      if (declarations.length > best.length) best = declarations;
    }
    if (best && named.includes(element)) break;
  }
  return best;
}

/**
 * Keep a root's `:host` variables equal to the app's current theme.
 *
 * Idempotent per root: the sheet is reused, only its text changes.
 *
 * @param root - the isolation root whose host should carry the variables.
 * @returns a disposer that stops syncing and removes the sheet.
 */
export function deliverThemeRoot(root: ShadowRoot): () => void {
  let sheet = root.querySelector<HTMLStyleElement>(`style[${ROOT_THEME_ATTRIBUTE}]`);
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.setAttribute(ROOT_THEME_ATTRIBUTE, "");
    root.prepend(sheet);
  }
  const owner = sheet;
  const sync = (): void => {
    const declarations = themeDeclarations();
    const css = declarations ? `:host { ${declarations} }` : "";
    if (owner.textContent !== css) owner.textContent = css;
  };
  const observer = new MutationObserver(() => sync());
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  sync();
  return () => {
    observer.disconnect();
    owner.remove();
  };
}

/**
 * Deliver the theme to the root a host element lives in, when it has one.
 *
 * A host outside an isolation root needs nothing: it inherits the document's
 * own theme. That is the case for the standalone viewing page.
 *
 * @param element - a host element the embed rendered.
 * @returns a disposer, or undefined when there is no root to deliver into.
 */
export function deliverThemeToHost(element: HTMLElement): (() => void) | undefined {
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? deliverThemeRoot(root) : undefined;
}
