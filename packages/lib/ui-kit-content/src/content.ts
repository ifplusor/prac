/**
 * Generic content composition protocols.
 *
 * A `ContentRoot` is a region's content root; its `content` is a group, a single
 * item, a nested layout root or an opaque host. A `ContentGroup` is one content
 * type (tabs / stack); `ContentItem` is one member. `ContentMount` is the
 * optional host binding — the model never holds DOM.
 *
 * @module prac-ui-kit-content/content
 */

/** Product-defined content kind; the kit never hard-codes window / board. */
export type ContentRootKind = string;

/** Constraints a content root reports to the layout solver. */
export interface ContentConstraints {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  /** The content wants the remaining space on its split axis. */
  readonly flex?: boolean;
}

/** One content offering and where it currently sits. */
export interface ContentInfo {
  readonly id: string;
  readonly region: string | null;
  readonly hidden: boolean;
  readonly order: number | null;
  readonly kind: string;
}

/** One content item: identity + the thing it renders. */
export interface ContentItem<TContent = unknown> {
  readonly id: string;
  readonly content: TContent;
}

/** One member's placement as the group sees it. */
export interface ContentPlacement {
  readonly itemId: string;
  readonly groupId: string;
  readonly order: number;
  readonly active: boolean;
  readonly visible: boolean;
  /** Whether the group owns the item record; absent means owned. */
  readonly owned?: boolean;
}

/** How a group presents its members. */
export type ContentGroupMode = "stack" | "select";

/** The group's own state. */
export interface ContentGroupState {
  readonly id: string;
  readonly mode: ContentGroupMode;
  readonly label?: string;
  readonly active?: string;
  readonly order: readonly string[];
}

/** A group of content items (tabs / stack). */
export interface ContentGroup<
  TItem extends ContentItem = ContentItem,
  TPlacement extends ContentPlacement = ContentPlacement,
> {
  readonly id: string;
  readonly state: ContentGroupState;
  readonly placements: readonly TPlacement[];
  readonly items?: readonly TItem[];
  onDidChange(listener: () => void): () => void;
  reorder(order: readonly string[]): void;
  dispose(): void;
}

/** A region's content root. `content` is deliberately not a group by default. */
export interface ContentRoot<TContent = unknown> {
  readonly kind: ContentRootKind;
  readonly content?: TContent;
  dispose(): void;
}

/** The optional host binding for a content root. */
export interface ContentMount<THost = HTMLElement> {
  readonly host?: THost;
  attach?(host: THost): void;
  detach?(host: THost): void;
  measure?(): ContentConstraints;
}
