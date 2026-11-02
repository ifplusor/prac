/**
 * Frame / Space state split.
 *
 * A Space is a virtual desktop of the stage: it owns the stage layout, while the
 * workbench shell (sidebar / panel / dock / chrome) is frame-level and survives
 * Space switches. The renderer still consumes one `LayoutState`; this module
 * composes it from the two owners and splits updates back.
 *
 * @module prac-ui-kit-workbench/frame-state
 */

import type { LayoutNode, RegionNode, SplitNode } from "prac-ui-kit-layout";
import type { LayoutState, ItemRecord } from "./contract.js";
import { findNode, replaceNode } from "prac-ui-kit-layout";
import { defaultTree } from "./model.js";
import { CENTER_MIN } from "./contract.js";
import type { LayoutStore } from "./store.js";

/** The region id a Space's stage tree occupies in the shell. */
export const STAGE_REGION = "stage";

/** One Space's stage: its tree and the placements inside that tree. */
export interface SpaceState {
  readonly tree: LayoutNode;
  readonly items: Record<string, ItemRecord>;
}

/** The frame shell's layout: everything outside the stage. */
export type FrameState = LayoutState;

/** A store over one Space's stage. */
export interface SpaceStore {
  get(): SpaceState;
  subscribe(listener: () => void): () => void;
  update(updater: (state: SpaceState) => SpaceState): void;
}

/** A store that fronts the active Space's stage store. */
export interface StageSwitcher extends SpaceStore {
  switchTo(store: SpaceStore): void;
  current(): SpaceStore;
}

/** The placeholder the shell keeps where a Space's stage root goes. */
function stagePlaceholder(): RegionNode {
  return {
    type: "region",
    id: STAGE_REGION,
    size: 0,
    flex: true,
    collapsed: false,
    cachedSize: 0,
    min: CENTER_MIN,
    priority: "high",
  };
}

/** Every node id in a subtree, including the root. */
function nodeIds(node: LayoutNode): Set<string> {
  const ids = new Set<string>();
  const visit = (current: LayoutNode): void => {
    ids.add(current.id);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return ids;
}

/** The shell state: the given tree with the stage replaced by its placeholder. */
export function createFrameState(tree: SplitNode = defaultTree()): FrameState {
  if (findNode(tree, STAGE_REGION) === null) {
    throw new Error(`default tree has no ${STAGE_REGION} node`);
  }
  return {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: replaceNode(tree, STAGE_REGION, stagePlaceholder),
    items: {},
    catalogueVersion: 0,
    activePanelId: null,
  };
}

/** A new Space's stage: the given stage root, empty placements. */
export function createSpaceState(stage: LayoutNode = defaultStage()): SpaceState {
  return { tree: stage, items: {} };
}

/** The stage root of the kit's default tree. */
function defaultStage(): LayoutNode {
  const stage = findNode(defaultTree(), STAGE_REGION);
  if (stage === null) throw new Error(`default tree has no ${STAGE_REGION} node`);
  return stage;
}

/** Compose the renderer's single state from the shell and the active Space. */
export function composeLayoutState(frame: FrameState, space: SpaceState): LayoutState {
  if (findNode(frame.tree, STAGE_REGION) === null) {
    throw new Error(`frame tree has no ${STAGE_REGION} node`);
  }
  return {
    ...frame,
    tree: replaceNode(frame.tree, STAGE_REGION, () => space.tree),
    items: { ...frame.items, ...space.items },
  };
}

/** Split a renderer state back into the shell and the active Space. */
export function splitLayoutState(state: FrameState): {
  frame: FrameState;
  space: SpaceState;
} {
  const stage = findNode(state.tree, STAGE_REGION);
  if (stage === null) throw new Error(`layout tree has no ${STAGE_REGION} node`);
  const stageIds = nodeIds(stage);
  const frameItems: Record<string, ItemRecord> = {};
  const spaceItems: Record<string, ItemRecord> = {};
  for (const [id, record] of Object.entries(state.items)) {
    if (stageIds.has(record.region)) spaceItems[id] = record;
    else frameItems[id] = record;
  }
  return {
    frame: {
      ...state,
      tree: replaceNode(state.tree, STAGE_REGION, stagePlaceholder),
      items: frameItems,
    },
    space: {
      tree: stage.type === "region" ? createSpaceState().tree : stage,
      items: spaceItems,
    },
  };
}

/** Front the active Space's stage store, waking subscribers on switch. */
export function createStageSwitcher(initial: SpaceStore): StageSwitcher {
  let active = initial;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };
  let offActive = active.subscribe(notify);
  return {
    get: () => active.get(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (updater) => active.update(updater),
    switchTo: (next) => {
      if (next === active) return;
      offActive();
      active = next;
      offActive = active.subscribe(notify);
      notify();
    },
    current: () => active,
  };
}

function sameFrame(left: FrameState, right: FrameState): boolean {
  return (
    left.tree === right.tree &&
    left.items === right.items &&
    left.viewportWidth === right.viewportWidth &&
    left.viewportHeight === right.viewportHeight &&
    left.catalogueVersion === right.catalogueVersion &&
    left.activePanelId === right.activePanelId
  );
}

function sameSpace(left: SpaceState, right: SpaceState): boolean {
  return left.tree === right.tree && left.items === right.items;
}

/**
 * A `LayoutStore` over the composed state.
 *
 * `get` composes shell + active Space; `update` splits the next state back into
 * the two owners. The shell store is the single owner of viewport,
 * catalogueVersion and activePanelId; the stage store only owns its tree and
 * placements.
 */
export function createComposedStore(frameStore: LayoutStore, stage: StageSwitcher): LayoutStore {
  let cache: LayoutState | undefined;
  const invalidate = (): void => {
    cache = undefined;
  };
  return {
    get: () => (cache ??= composeLayoutState(frameStore.get(), stage.get())),
    subscribe: (listener) => {
      const offFrame = frameStore.subscribe(() => {
        invalidate();
        listener();
      });
      const offStage = stage.subscribe(() => {
        invalidate();
        listener();
      });
      return () => {
        offFrame();
        offStage();
      };
    },
    update: (updater) => {
      const current = composeLayoutState(frameStore.get(), stage.get());
      const next = updater(current);
      if (next === current) return;
      const split = splitLayoutState(next);
      if (!sameSpace(stage.get(), split.space)) stage.update(() => split.space);
      if (!sameFrame(frameStore.get(), split.frame)) frameStore.update(() => split.frame);
      invalidate();
    },
    requestCloseItem: (itemId) => frameStore.requestCloseItem(itemId),
  };
}
