import { describe, expect, it } from "vite-plus/test";

import { findNode, findRegion } from "prac-ui-kit-layout";
import type { LayoutState, ViewRecord } from "./contract.js";
import {
  STAGE_REGION,
  composeLayoutState,
  createComposedStore,
  createFrameState,
  createSpaceState,
  createStageSwitcher,
  splitLayoutState,
  type SpaceState,
  type SpaceStore,
} from "./frameState.js";
import type { LayoutStore } from "./store.js";

const view = (region: string, order = 0): ViewRecord => ({
  kind: "window",
  region,
  order,
  hidden: false,
});

function memory<T>(initial: T): {
  get: () => T;
  subscribe: (listener: () => void) => () => void;
  update: (updater: (state: T) => T) => void;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (updater) => {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

function frameStore(initial: LayoutState = createFrameState()): LayoutStore {
  const cell = memory(initial);
  return { ...cell, requestCloseView: () => undefined };
}

function spaceStore(initial: SpaceState = createSpaceState()): SpaceStore {
  return memory(initial);
}

describe("frame / space state", () => {
  it("keeps the stage as a placeholder in the shell and a tree in the Space", () => {
    const frame = createFrameState();
    const space = createSpaceState();
    expect(findNode(frame.tree, STAGE_REGION)?.type).toBe("region");
    expect(findNode(space.tree, STAGE_REGION)?.type).toBe("grid");
    expect(findRegion(frame.tree, "left")?.id).toBe("left");
    expect(findRegion(space.tree, "center")?.id).toBe("center");
  });

  it("composes one tree from shell + Space and keeps their views apart", () => {
    const frame = createFrameState();
    const space = createSpaceState();
    frame.views["shell-view"] = view("left");
    space.views["stage-view"] = view("center");
    const composed = composeLayoutState(frame, space);
    expect(findNode(composed.tree, STAGE_REGION)?.type).toBe("grid");
    expect(composed.views["shell-view"]).toBeDefined();
    expect(composed.views["stage-view"]).toBeDefined();

    const split = splitLayoutState(composed);
    expect(findNode(split.frame.tree, STAGE_REGION)?.type).toBe("region");
    expect(split.frame.views["shell-view"]).toBeDefined();
    expect(split.frame.views["stage-view"]).toBeUndefined();
    expect(split.space.views["stage-view"]).toBeDefined();
    expect(split.space.views["shell-view"]).toBeUndefined();
  });

  it("routes an update to the owner of the region it changes", () => {
    const frame = frameStore();
    const stage = createStageSwitcher(spaceStore());
    const store = createComposedStore(frame, stage);

    store.update((state) => ({
      ...state,
      views: { ...state.views, shell: view("left"), stage: view("center") },
    }));

    expect(frame.get().views.shell).toBeDefined();
    expect(frame.get().views.stage).toBeUndefined();
    expect(stage.get().views.stage).toBeDefined();
    expect(stage.get().views.shell).toBeUndefined();
  });

  it("caches the composed snapshot until an owner changes", () => {
    const store = createComposedStore(frameStore(), createStageSwitcher(spaceStore()));
    const first = store.get();
    expect(store.get()).toBe(first);
    store.update((state) => ({ ...state, viewportWidth: 42 }));
    expect(store.get()).not.toBe(first);
    expect(store.get()).toBe(store.get());
  });

  it("switches the stage without touching the shell", () => {
    const frame = frameStore();
    frame.get().views.shell = view("left");
    const first = spaceStore();
    const second = spaceStore();
    second.update((state) => ({ ...state, views: { other: view("center") } }));
    const stage = createStageSwitcher(first);
    const store = createComposedStore(frame, stage);

    stage.switchTo(second);
    expect(store.get().views.shell).toBeDefined();
    expect(store.get().views.other).toBeDefined();
    expect(store.get().views.shell).toBe(frame.get().views.shell);
  });
});
