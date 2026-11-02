/**
 * The `pracDsh` service's type-only contract.
 *
 * Types only: this module is the pack's `client-types` entry, published as
 * `exports["./client"].types`. It exists because the loader artifact carries a
 * banner/footer and cannot ship a declaration file, while consumers still need
 * the `Context` merge in their own program.
 *
 * @module prac-client-ui-dsh/client/contract
 */

import type {} from "@deepseek-ai/cordis";

// Re-exported so the declaration artifact imports the real modules before it
// augments them; a bare `declare module` alone lets a consumer see only the
// merged members (no `ctx.effect` / `ctx.provide`).
export type { Context } from "@deepseek-ai/cordis";

/** DSH slot ids and keyed-main helpers, provided to the workbench. */
export interface PracDshFace {
  readonly sidebar: string;
  readonly rightbar: string;
  readonly conversation: string;
  readonly mainPrefix: string;
  mainView(key: string): string;
  mainKey(viewId: string): string | undefined;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    pracDsh: PracDshFace;
  }
}
