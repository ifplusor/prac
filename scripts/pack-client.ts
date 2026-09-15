/**
 * The `pack` entry that turns a package's client half into DSH's client artifact.
 *
 * DSH serves `exports["./client"]` **verbatim** and evaluates it as
 * `window.__ModuleLoader__.load({ id, factory })` — a closure factory, not an
 * ESM/CJS module the browser would `import`. So the declared `pack` config has
 * to build the artifact, not merely a bundle:
 *
 * - the bundle is **CJS on the browser platform** (the loader's module table
 *   answers `require`), with only the declared externals left unresolved;
 * - the `banner` opens the loader closure *and* declares the CJS envelope inside
 *   it, and the `footer` returns the exports;
 * - `outExtensions` pins the file to `client.js`, which is what
 *   `package.json` `exports["./client"]` points at.
 *
 * It lives outside the packages because this is **one contract shared by every
 * prac client half** — the loader's shape, not a per-package choice. A package's
 * `vite.config.ts` reads as what that package *is*: its entries, its externals.
 * `scripts/bundle-client.mjs` holds the other half of the contract — the
 * assertions that the emitted artifact really has this shape.
 *
 * @module scripts/pack-client
 */

/**
 * The specifiers DSH's shell shares into the loader's frozen module table.
 *
 * Mirrors `PLATFORM_MODULES` in DSH's `packages/client/web/src/platform.ts` (the
 * shell's own single source of truth, read 2026-09-15; the shell seeds the table
 * from it in `packages/client/web/src/seed.ts`). A `require` outside this list is
 * a guaranteed runtime throw; a specifier **inside** it that a bundle inlines
 * instead of requiring is a duplicated singleton — for `react` a blank page, for
 * the store a second copy of the state engine.
 */
export const PLATFORM_MODULES = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
] as const;

/**
 * The platform words a client half leaves for the loader unless it says
 * otherwise. `react` is not optional — an inlined React is a blank page, so no
 * package may trade it away.
 */
const BASELINE_EXTERNALS = ["react"] as const;

/**
 * The entries this helper wraps: the artifact's own file name and the source it
 * is built from. `client` is the key, so the emitted name is exactly
 * `client.js` once `outExtensions` strips the suffix.
 */
export interface ClientPackOptions {
  /** Source file of the client half (a package-relative path). */
  readonly entry?: string;
  /**
   * Further {@link PLATFORM_MODULES} words this bundle leaves to the shell,
   * *in addition to* the baseline — additive so a package cannot accidentally
   * inline React. Naming a non-platform specifier fails the build here rather
   * than at page load.
   */
  readonly external?: readonly string[];
}

/**
 * The `pack` config for one package's client half.
 *
 * @param id - the bundle id stamped into the loader handoff; must equal the
 * package name DSH composes the bundle by.
 * @param options - entry override and extra platform words; defaults to
 * `src/client.ts` and the baseline externals.
 * @returns a `pack` entry ready to sit beside the host half in the same array.
 */
export function clientPack(id: string, options: ClientPackOptions = {}) {
  const entry = options.entry ?? "src/client.ts";
  const extra = options.external ?? [];
  const strays = extra.filter((word) => !(PLATFORM_MODULES as readonly string[]).includes(word));
  if (strays.length > 0) {
    throw new Error(
      `clientPack(${id}): ${strays.join(", ")} is not a word DSH's module table answers; ` +
        "the require would throw at boot — import it as a type, or inline it",
    );
  }
  return {
    entry: { client: entry },
    format: "cjs" as const,
    platform: "browser" as const,
    // The host half's declarations are the published types; a client half has
    // no importable surface (the browser reaches it through the loader), and
    // dts would wrap the banner/footer into a .d.ts the type system must parse.
    dts: false,
    deps: { neverBundle: [...BASELINE_EXTERNALS, ...extra] },
    outExtensions: () => ({ js: ".js" }),
    banner: {
      // The Envelope must be declared *inside* the factory before any bundled
      // code runs. It is spelled into the banner rather than handed to the
      // bundler's `intro` field: `intro` is silently ignored on this toolchain,
      // which yields an artifact that looks right and throws `ReferenceError:
      // exports is not defined` at boot. `scripts/bundle-client.mjs` asserts the
      // declaration is present, so a silent drop cannot come back unnoticed.
      js:
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n` +
        "var module = { exports: {} }; var exports = module.exports;",
    },
    footer: { js: "return module.exports; } });" },
  };
}

/** The externals {@link clientPack} leaves unresolved; asserted after the build. */
export const CLIENT_EXTERNALS: readonly string[] = BASELINE_EXTERNALS;
