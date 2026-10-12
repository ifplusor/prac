/**
 * The client half's **published type surface**.
 *
 * Types only: this module exists so the pack's dts pass emits a declaration
 * bundle for the view consumers (`prac-client-ui-vscode-editor`, `…-explorer`) to import —
 * the thing that lets them stop restating this mechanism's face by hand. It must
 * stay free of runtime code (the emitted `.mjs` is a stub); the executable client
 * half is `index.ts`, wrapped by `scripts/pack-client.ts` into the loader artifact.
 *
 * The type surface below, and the DSH merges it needs, reach a consumer through
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
   * Everything the app currently offers as a prac view, from **both** upstream
   * services.
   *
   * The app has two sources — its open files (`IEditorService`) and the views its
   * view registry reports (`IViewDescriptorService`) — and this is the one shape
   * they are turned into, so a consumer registers `prac.view` entries and mounts
   * them without knowing which upstream service an entry came from. The frame
   * sees the same thing either way; only {@link VscodeCatalogueEntry.source}
   * records where it came from.
   *
   * Entries come and go: a file entry exists while the file is open, a view entry
   * while its `when` holds. A consumer re-reads on {@link onDidChangeCatalogue}.
   *
   * @returns one entry per offered view.
   */
  catalogue(): readonly VscodeCatalogueEntry[];
  /**
   * Subscribe to changes in the catalogue.
   *
   * @param listener - called when the set changed; re-read {@link catalogue}.
   * @returns a function that unsubscribes.
   */
  onDidChangeCatalogue(listener: () => void): () => void;
  /**
   * The mount component for any catalogue entry, by its view id.
   *
   * One entry point for both sources: the id convention (and therefore which
   * upstream call mounts it) belongs to this package, so consumers never branch
   * on it.
   *
   * @param view - a view id from {@link catalogue}.
   * @returns a component rendering the host element the content is mounted into,
   * or one rendering nothing when the id is not offered.
   */
  hostFor(view: string): () => ReactElement | null;
  /**
   * The app's **placement** behind a view id, or `undefined` when the id is not a
   * file view.
   *
   * A placement is a file in one of the app's editor groups, named by the app's own
   * token. The id convention belongs to this package, so a consumer that has to pair a
   * view with the app's own state (the `editors` capability reports one entry per
   * placement) asks here rather than parsing the id itself.
   *
   * @param view - any view id.
   */
  /**
   * Register the gate-only timeline provider (a probe, not a product feature).
   */
  enableTimelineProbe(): void;
  filePlacement(view: string): { placement: string; resource: string } | undefined;
  /**
   * The app resource behind a view id, or `undefined` when the id is not a file
   * view.
   *
   * The id convention belongs to this package, so a consumer that only needs to
   * recognise a file view asks here rather than matching a prefix itself.
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
         * Close one placement's editor.
         *
         * @param placement - the placement whose editor should close.
         * @param resource - the app's URI for the file.
         */
        close(placement: string, resource: string): void;
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
  /**
   * The placement this entry is: the app's name for a file in one of its editor groups.
   *
   * One entry per group, so the same file open in two groups is two entries — and this is
   * what tells them apart (the resource alone cannot, and the group number changes when the
   * placement moves). A consumer keys its own state by it.
   */
  readonly placement: string;
  /**
   * The group holding this editor and the prac region it belongs to.
   *
   * A group that no prac region owns yet reports `null` for the region.
   */
  readonly group: number;
  readonly region: string | null;
}

/**
 * One thing the app offers as a prac view, as {@link PracVscodeFace.catalogue}
 * reports it.
 *
 * Plain data: a consumer registers `prac.view` entries from these and mounts
 * them through {@link PracVscodeFace.hostFor}, and the arrangement uses
 * {@link VscodeCatalogueEntry.location} for its own default placement. Nothing
 * here says how the frame renders it — that is the frame's business.
 */
export interface VscodeCatalogueEntry {
  /**
   * The prac view id.
   *
   * `vscode:file:<placement>:<resource>` for a file the app has open, in the placement
   * the app reports it as; `vscode:view:<viewId>` for a view the app's view registry
   * reports. The convention belongs to this package.
   */
  readonly view: string;
  /**
   * The **app's own** identity for this entry — the view id for a view, the URI
   * for a file.
   *
   * Exposed so policy written in the app's vocabulary (leave Copilot's chat off
   * screen, say) can name things without restating this package's id convention.
   */
  readonly appId: string;
  /** The display name (`report.md`, `Problems`). */
  readonly title: string;
  /** Which upstream service it came from: the editor service, or the view registry. */
  readonly source: "file" | "view";
  /**
   * The app's own word for where this belongs, as a default-placement hint —
   * `stage` for an open file, otherwise the container's location.
   */
  readonly location: "stage" | "sidebar" | "panel" | "auxiliarybar";
  /**
   * For `file` entries: the prac region the app's group for this placement is shown
   * in, or `null` while nothing shows it yet.
   *
   * A **default** placement, like {@link location}: the app says where its editor is,
   * and the arrangement decides whether to honour it.
   */
  readonly region?: string | null;
  /** For `view` entries: the container the view is registered in. */
  readonly containerId?: string;
  /** For `view` entries: the container's display name, for grouping. */
  readonly containerTitle?: string;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    /** The shared VS Code client mechanism, provided by this package. */
    pracVscode: PracVscodeFace;
  }
}
