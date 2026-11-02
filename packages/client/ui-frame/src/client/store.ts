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
import {
  createFrameState,
  createSpaceState,
  normalizeGrids,
  normalizeViews,
  type LayoutState,
  type LayoutStore,
  type SpaceState,
  type SpaceStore,
  type ViewRecord,
} from "prac-ui-kit-frame";

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

/** A persisted state cell whose hydrated value passes through `heal` once. */
function createCell<T>(initial: T, key: string, heal: (state: T) => T): StoreCell<T> {
  // `flush: "raf"` batches a burst of updates into one frame; persistence writes
  // on every committed state. The caller supplies the key: the frame scopes it
  // by workspace (`?workspace=`, the same identity the page boots from), so two
  // folders on one origin do not share a layout.
  const snapshot = createSnapshotStore<T>(initial, {
    flush: "raf",
    persist: { name: key },
  });
  const hydrated = snapshot.getSnapshot();
  const healed = heal(hydrated);
  if (healed !== hydrated) snapshot.set(healed);
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
  const rawViews = state.views as Record<string, ViewRecord & { kind?: "window" | "widget" }>;
  const views = Object.fromEntries(
    Object.entries(rawViews).map(([id, record]) => [
      id,
      { ...record, kind: record.kind ?? "window" } as ViewRecord,
    ]),
  );
  const withKind = { ...state, views };
  const healedTree = normalizeGrids(withKind.tree);
  return normalizeViews(
    healedTree === withKind.tree ? withKind : { ...withKind, tree: healedTree },
  );
}

/** A stage state has no frame-level fields; normalize its tree and placements. */
function healSpace(state: SpaceState): SpaceState {
  const withKind: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: state.tree,
    views: state.views,
    catalogueVersion: 0,
    activePanelId: null,
  };
  const healed = healState(withKind);
  return { tree: healed.tree, views: healed.views };
}

/** Create the frame shell's store. */
export function createFrameStore(
  onRequestCloseView: (viewId: string) => void = () => {},
  key: string = FRAME_STATE_KEY,
): LayoutStore {
  return {
    ...createCell(createFrameState(), key, healState),
    requestCloseView: onRequestCloseView,
  };
}

/** Create one Space's stage store. */
export function createSpaceStore(key: string = SPACE_STATE_KEY): SpaceStore {
  return createCell(createSpaceState(), key, healSpace);
}
