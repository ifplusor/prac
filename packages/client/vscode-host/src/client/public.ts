/**
 * The client half's **published type surface**.
 *
 * Types only: this module exists so the pack's dts pass emits a declaration
 * bundle for the seats (`prac-client-ui-vscode-editor`, `…-explorer`) to import —
 * the thing that lets them stop restating this mechanism's face by hand. It must
 * stay free of runtime code (the emitted `.mjs` is a stub); the executable client
 * half is `index.ts`, wrapped by `scripts/pack-client.ts` into the loader artifact.
 *
 * The declaration below, and the DSH merges it needs, reach a consumer through
 * this single import.
 *
 * @module prac-client-vscode-host/client/public
 */

import type { ReactElement } from "react";

// The DSH client halves whose `Context` merges a consumer of this package needs
// (the boot resolves its workspace and session from them). Re-exported as types:
// erased at runtime, but they put the merges in the consumer's program.
export type { IWorkspaces } from "@deepseek-ai/dsh-api-workspace-controller/client";
export type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";

/** The shared VS Code client mechanism this package publishes on the registry. */
export interface PracVscodeFace {
  /**
   * The seat component for one view id.
   *
   * @param view - the view id a seat declares (`vscode:editor`, `vscode:sidebar`).
   * @returns a component rendering the host element the part is mounted into.
   */
  partHost(view: string): () => ReactElement | null;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The shared VS Code client mechanism, provided by this package. */
    pracVscode: PracVscodeFace;
  }
}
