/**
 * Typed widget registration.
 *
 * There is no generic CRD here: a widget is a descriptor plus a host factory;
 * a board binding supplies source-specific context. The frame owns placement;
 * this module only owns definition identity and host creation.
 *
 * @module prac-client-ui-widget/client/widget
 */

/** Source label; kept open so a new adapter does not need a core change. */
export type WidgetSource = string;

/** How a widget's content is hosted. */
export type WidgetHostKind = "view-pane" | "react" | "webview" | (string & {});

/** One widget kind. */
export interface WidgetDefinition {
  readonly id: string;
  readonly source: WidgetSource;
  readonly hostKind: WidgetHostKind;
  readonly title: string;
  readonly icon?: string;
  /** Default board hint; not ownership. */
  readonly defaultBoard?: string;
  /** The catalogue's location word; the dock derives its side from it. */
  readonly defaultRegion?: string;
  readonly multiplicity: "single" | "multi";
  readonly actions?: readonly WidgetActionRef[];
}

/** An action offered by a widget, resolved by its source. */
export interface WidgetActionRef {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

/** A widget's runtime boundary. */
export interface WidgetHost {
  mount(element: HTMLElement): void;
  release(): void;
  focus(): void;
  readonly focusable: boolean;
}

/** Optional source hint when a widget moves. */
export interface MoveIntent {
  readonly fromBoardId: string;
  readonly toBoardId: string;
  readonly reason: "user" | "layout";
  readonly preserve?: "auto" | "state" | "never";
}

/** Creates a host for one widget definition. */
export interface WidgetHostFactory {
  create(definition: WidgetDefinition, options?: { readonly move?: MoveIntent }): WidgetHost;
}

/** Board-level context supplied by a source adapter. */
export interface BoardBinding {
  dispose(): void;
}

/** A widget placement edge; owned by the board, not the widget. */
export interface WidgetPlacement {
  readonly widgetId: string;
  readonly boardId: string;
  readonly order: number;
  readonly size?: { readonly width?: number; readonly height?: number };
}

/** Registry of widget definitions, keyed by id. */
export class WidgetRegistry {
  readonly #definitions = new Map<string, WidgetDefinition>();
  readonly #listeners = new Set<() => void>();

  /** Subscribe to definitions being added or removed. */
  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  /** Register a definition; duplicate id is rejected. */
  register(definition: WidgetDefinition): { dispose(): void } {
    if (this.#definitions.has(definition.id)) {
      throw new Error(`widget already registered: ${definition.id}`);
    }
    this.#definitions.set(definition.id, definition);
    this.#notify();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.#definitions.get(definition.id) === definition) {
          this.#definitions.delete(definition.id);
          this.#notify();
        }
      },
    };
  }

  /** Look up a definition by id. */
  lookup(id: string): WidgetDefinition | undefined {
    return this.#definitions.get(id);
  }

  /** Enumerate definitions in registration order. */
  list(): readonly WidgetDefinition[] {
    return [...this.#definitions.values()];
  }

  /** Whether a definition is registered. */
  has(id: string): boolean {
    return this.#definitions.has(id);
  }
}
