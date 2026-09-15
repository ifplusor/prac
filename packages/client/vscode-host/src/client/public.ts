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
   * The seat component for one view id, backed by a **part**.
   *
   * @param view - the view id a seat declares (`vscode:editor`, `vscode:sidebar`).
   * @returns a component rendering the host element the part is mounted into.
   */
  partHost(view: string): () => ReactElement | null;
  /**
   * The seat component for one view id, backed by a single VS Code **view**.
   *
   * The finer unit: its own pane outside any part, released when the component
   * unmounts so it can be created again. Returns a component rendering nothing
   * when this seat has no view behind it.
   *
   * @param view - the view id a seat declares (`vscode:sidebar`).
   * @returns a component rendering the host element the view is created into.
   */
  viewHost(view: string): () => ReactElement | null;
  /**
   * The files the app currently has open, as view ids a seat can declare.
   *
   * Decision 17's unit: the app contributes one file's editing surface
   * (`vscode:file:<resource>`), while which files are open comes from the app's
   * own editor service — an explorer click or a command opens a file there, and
   * the embedder has to turn it into a view.
   *
   * @returns one entry per open file, oldest first.
   */
  fileViews(): readonly VscodeFileView[];
  /**
   * Subscribe to changes in the open-file set.
   *
   * @param listener - called when the set changed; re-read {@link fileViews}.
   * @returns a function that unsubscribes.
   */
  onDidChangeFileViews(listener: () => void): () => void;
  /**
   * The seat component for one `vscode:file:<resource>` view.
   *
   * @param view - the file view id from {@link fileViews}.
   * @returns a component rendering the host element the file is mounted into,
   * or one rendering nothing when the id is not a file view.
   */
  fileHost(view: string): () => ReactElement | null;
  /**
   * The app resource behind a view id, or `undefined` when the id is not a file
   * view.
   *
   * The id convention (`vscode:file:<resource>`) belongs to this package, so a
   * consumer that needs to recognise a file view asks here rather than matching a
   * prefix itself.
   *
   * @param view - any view id.
   */
  fileResource(view: string): string | undefined;
}

/** One open file, as the pair of view id and app resource. */
export interface VscodeFileView {
  /** The view id a seat declares for this file. */
  readonly view: string;
  /** The app's URI for the file. */
  readonly resource: string;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The shared VS Code client mechanism, provided by this package. */
    pracVscode: PracVscodeFace;
  }
}
