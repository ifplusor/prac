/**
 * The theme presenter: resolved theme snapshots written into the DOM.
 *
 * Extracted verbatim from the client half during the module split; it depends on
 * nothing else in the package (a snapshot type and the DOM), which is why it is
 * the first domain to come out.
 *
 * @module prac-client-ui-frame/client/theme
 */

import type { ThemeSnapshot } from "@deepseek-ai/dsh-client-ui-theme/client";

// ── theme presentation ────────────────────────────────────────────────
// Mirrors ui-layout's presenter: the token palette, the content font-size
// axis, and the browser theme-color all arrive from resolved snapshots as
// pure DOM writes. It only retracts what it wrote itself.

/** Body attribute selecting the dark base palette in the token stylesheets. */
const DARK_ATTRIBUTE = "data-ds-dark-theme";
/** Body variable carrying the user's content font size in px. */
const CONTENT_FONT_SIZE_VARIABLE = "--dsh-content-font-size";

export class ThemePresenter {
  /** Token names written by the last apply (its retraction set). */
  private appliedTokens: string[] = [];
  private readonly themeColorMeta: HTMLMetaElement;

  constructor() {
    this.themeColorMeta = document.createElement("meta");
    this.themeColorMeta.name = "theme-color";
  }

  /**
   * Write a resolved theme snapshot into the DOM.
   *
   * @param snapshot - resolved theme snapshot from `ctx.theme`.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme;
    document.documentElement.style.colorScheme = scheme;
    const body = document.body;
    if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, "");
    else body.removeAttribute(DARK_ATTRIBUTE);
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSizes.text}px`);
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = [];
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value);
      this.appliedTokens.push(name);
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
  }

  /** Retract everything this presenter wrote. */
  dispose(): void {
    document.documentElement.style.removeProperty("color-scheme");
    const body = document.body;
    body.removeAttribute(DARK_ATTRIBUTE);
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE);
    for (const name of this.appliedTokens) body.style.removeProperty(name);
    this.appliedTokens = [];
    this.themeColorMeta.remove();
  }
}
