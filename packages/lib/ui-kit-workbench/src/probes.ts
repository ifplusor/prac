/**
 * The page-level probe registry the live gates read the client model through.
 *
 * A driver script runs in the page and cannot reach the Cordis context, so the
 * plugins publish their faces on `globalThis.__pracTest` — one object, one
 * registry, instance-scoped cleanup. A probe is a named field: `frame`,
 * `boardLayouts`, `spaces`, `widgets`, `vscode`… Adding one is a publish call in
 * the owning plugin and a reader in the gate, not another ad-hoc global.
 *
 * The registry is deliberately untyped (`unknown`): each face is owned by the
 * plugin that publishes it, and the gate-side shape is declared where it is
 * read. This keeps the kit independent of the client packages.
 *
 * @module prac-ui-kit-workbench/probes
 */

/** The probe surface: named faces published for the page's drivers. */
export type PracProbeSurface = Record<string, unknown>;

declare global {
  /** The probe surface, published by the plugins that own each face. */
  var __pracTest: PracProbeSurface | undefined;
}

/**
 * Publish one named probe.
 *
 * @param name - the field name gates read (`__pracTest.<name>`).
 * @param value - the face.
 * @returns cleanup that removes the field only while this value still owns it.
 */
export function publishProbe(name: string, value: unknown): () => void {
  const surface = (globalThis.__pracTest ??= {});
  surface[name] = value;
  return () => {
    if (surface[name] !== value) return;
    delete surface[name];
    if (Object.keys(surface).length === 0 && globalThis.__pracTest === surface) {
      delete globalThis.__pracTest;
    }
  };
}
