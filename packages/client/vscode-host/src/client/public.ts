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
  /**
   * The app's capabilities, addressed by name — the same handle the UI renders
   * and an agent consumer reads.
   *
   * @see the `Capability` envelope in `prac-vscode`'s bridge: `snapshot` +
   * `subscribe` for rendering, `settled` + `version` for anyone acting on the
   * data, and the actions the capability allows.
   */
  readonly capabilities: {
    /** The open editor set: what is open, what is active, what is unsaved. */
    readonly editors: {
      /** One entry per open file. */
      snapshot(): readonly VscodeEditorEntry[];
      /**
       * Subscribe to changes.
       *
       * @param listener - called after a change; re-read {@link snapshot}.
       * @returns a function that unsubscribes.
       */
      subscribe(listener: () => void): () => void;
      /** Resolves when the async sources behind the capability have caught up. */
      settled(): Promise<void>;
      /** A monotonic revision of the snapshot, for provenance. */
      version(): number;
      /** What may be done to the editor set. */
      readonly actions: {
        /**
         * Make a file's editor the app's active one — the UI calls this when its
         * own "current" changes (a tab click), so the two cannot disagree.
         *
         * @param resource - the app's URI for the file.
         */
        activate(resource: string): void;
        /**
         * Close a file's editor.
         *
         * @param resource - the app's URI for the file.
         */
        close(resource: string): void;
      };
    };
    /**
     * The problems the app knows about.
     *
     * Read-only, paginated, and the first capability whose data arrives **late**:
     * `settled()` is what a consumer must await before treating the set as the
     * truth.
     */
    readonly diagnostics: {
      /** A summary plus the most severe page. */
      snapshot(): VscodeDiagnosticsSnapshot;
      /**
       * A page of diagnostics, optionally for one file.
       *
       * @param query - the filter and page.
       */
      query(query: VscodeDiagnosticsQuery): VscodeDiagnosticsPage;
      /**
       * Subscribe to changes.
       *
       * @param listener - called after a change; re-read {@link snapshot}.
       * @returns a function that unsubscribes.
       */
      subscribe(listener: () => void): () => void;
      /** Resolves when the markers have stopped arriving (bounded). */
      settled(): Promise<void>;
      /** A monotonic revision of the set, for provenance. */
      version(): number;
    };
  };
}

/** One diagnostic, as this face reports it. */
export interface VscodeDiagnosticEntry {
  /** The file the marker belongs to, as the app's URI string. */
  readonly resource: string;
  readonly severity: "error" | "warning" | "info" | "hint";
  readonly message: string;
  readonly source?: string;
  readonly code?: string;
  /** 1-based positions, as the app reports them. */
  readonly range: {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
  };
}

/** Counts, so a consumer can decide whether the detail is worth asking for. */
export interface VscodeDiagnosticsSummary {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly hint: number;
  /** How many files carry at least one diagnostic. */
  readonly resources: number;
}

/** A bounded slice of the diagnostics. */
export interface VscodeDiagnosticsPage {
  readonly entries: readonly VscodeDiagnosticEntry[];
  /** How many matched the query, before paging. */
  readonly total: number;
  readonly offset: number;
  readonly truncated: boolean;
}

/** The default view: a summary plus the most severe page. */
export interface VscodeDiagnosticsSnapshot {
  readonly summary: VscodeDiagnosticsSummary;
  readonly page: VscodeDiagnosticsPage;
}

/** A query for one file or one page. */
export interface VscodeDiagnosticsQuery {
  /** Restrict to one file (the app's URI string). Absent means everything. */
  readonly resource?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** One open editor, as this face reports it. */
export interface VscodeEditorEntry {
  /** The app's URI for the file. */
  readonly resource: string;
  /** Whether this is the app's active editor. */
  readonly active: boolean;
  /** Whether the editor has unsaved changes. */
  readonly dirty: boolean;
  /** Whether the editor is in preview mode. */
  readonly preview: boolean;
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
