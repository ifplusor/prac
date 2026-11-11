import {
  createFrameState,
  createSpaceState,
  defaultTree,
  normalizeItems,
  type LayoutState,
  type LayoutStore,
  type SpaceState,
  type SpaceStore,
  type ItemRecord,
} from "prac-ui-kit-workbench";
import { type LayoutNode, type SplitNode, normalizeGrids } from "prac-ui-kit-layout";
/**
 * The frame's persisted stores: one shell state (frame-level) and one stage
 * state per Space.
 *
 * This is the DSH half of the kit's `LayoutStore` / `SpaceStore`: the plugin
 * owns the state engines (`dsh-client-store`, a platform word seeded by the
 * shell) and the persisted keys. The kit still owns the interfaces and the
 * React hooks, so a board can implement the same contract over its own
 * in-memory state.
 *
 * @module prac-client-ui-frame/client/store
 */

import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";

/**
 * The frame shell's key: sidebar / panel / dock / stage placeholder.
 *
 * A generation, not a schema revision: the engine rehydrates whatever sits
 * under it. The `v1` generation is the split between frame shell and Space
 * stage; the previous full-layout keys are not migrated (a reset is
 * acceptable for this split).
 */
export const FRAME_STATE_KEY = "prac-frame/v1";

/** One Space's stage key: `<space-key>/<workspace>/<space-id>`. */
export const SPACE_STATE_KEY = "prac-space/v1";

interface StoreCell<T> {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
  update: (updater: (state: T) => T) => void;
}

/**
 * Read a persistence snapshot.
 *
 * The snapshot is the recovery artifact, not the runtime: the layout lives in
 * the window manager, and this channel only carries a copy across a reload.
 */
export function readSnapshot<T>(key: string): T | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Write a persistence snapshot; a blocked/full storage never breaks the runtime. */
export function writeSnapshot<T>(key: string, value: T): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // The runtime keeps working; the next write may succeed.
  }
}

/**
 * A runtime cell whose persisted snapshot passes through `heal` once at boot.
 *
 * The snapshot channel is this cell's only persistence: the cell subscribes and
 * writes, and reads only at construction. It is not a store the render reads
 * from — the render reads the window manager — but the frame's layout cells are
 * still the runtime state they are today.
 */
function createCell<T>(initial: T, key: string, heal: (state: T) => T): StoreCell<T> {
  // `flush: "raf"` batches a burst of updates into one frame. The caller supplies
  // the key: the frame scopes it by workspace (`?workspace=`), so two folders on
  // one origin do not share a layout.
  const hydrated = readSnapshot<T>(key);
  const healed = heal(hydrated ?? initial);
  const snapshot = createSnapshotStore<T>(healed, { flush: "raf" });
  snapshot.subscribe(() => writeSnapshot(key, snapshot.getSnapshot()));
  return {
    get: () => snapshot.getSnapshot(),
    subscribe: (listener) => snapshot.subscribe(listener),
    update: (updater) => {
      const current = snapshot.getSnapshot();
      const next = updater(current);
      if (next === current) return;
      snapshot.set(next);
    },
  };
}

/** Default old records to `kind: "window"` and heal stale placements. */
function healState(state: LayoutState): LayoutState {
  // Old generations wrote the table under `views`; keep them readable without a
  // key bump. The next write persists the new `items` shape.
  const legacy = state as unknown as {
    views?: Record<string, ItemRecord & { kind?: "window" | "widget" }>;
  };
  const rawViews = (state.items ?? legacy.views) as Record<
    string,
    ItemRecord & { kind?: "window" | "widget" }
  >;
  const items = Object.fromEntries(
    Object.entries(rawViews).map(([id, record]) => [
      id,
      { ...record, kind: record.kind ?? "window" } as ItemRecord,
    ]),
  );
  const withKind = { ...state, items };
  const healedTree = normalizeGrids(withKind.tree);
  return normalizeItems(
    healedTree === withKind.tree ? withKind : { ...withKind, tree: healedTree },
  );
}

/** A stage state has no frame-level fields; normalize its tree and placements. */
function healSpace(state: SpaceState): SpaceState {
  const withKind: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: state.tree,
    items: state.items,
    catalogueVersion: 0,
    activePanelId: null,
  };
  const healed = healState(withKind);
  return { tree: healed.tree, items: healed.items };
}

/** Create the frame shell's store. */
export function createFrameStore(
  onRequestCloseView: (viewId: string) => void = () => {},
  key: string = FRAME_STATE_KEY,
  tree: SplitNode = defaultTree(),
): LayoutStore {
  return {
    ...createCell(createFrameState(tree), key, healState),
    requestCloseItem: onRequestCloseView,
  };
}

/** Create one Space's stage store. */
export function createSpaceStore(key: string = SPACE_STATE_KEY, stage?: LayoutNode): SpaceStore {
  return createCell(createSpaceState(stage), key, healSpace);
}
