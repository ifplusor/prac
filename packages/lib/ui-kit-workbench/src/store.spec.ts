import { describe, expect, it } from "vite-plus/test";
import type { LayoutState } from "./contract.js";
import { defaultTree } from "./model.js";
import { createSwitchingStore } from "prac-ui-kit-content";
import type { LayoutStore } from "./store.js";

/** A minimal layout store whose only meaningful state is its active panel. */
function make(panel: string | null): { store: LayoutStore; listeners: Set<() => void> } {
  let state: LayoutState = {
    viewportWidth: 0,
    viewportHeight: 0,
    tree: defaultTree(),
    items: {},
    catalogueVersion: 0,
    activePanelId: panel,
  };
  const listeners = new Set<() => void>();
  return {
    listeners,
    store: {
      get: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update: (updater) => {
        state = updater(state);
        for (const listener of listeners) listener();
      },
      requestCloseItem: () => {},
    },
  };
}

describe("createSwitchingStore", () => {
  it("reads the active store and follows a switch", () => {
    const first = make("first");
    const second = make("second");
    const switching = createSwitchingStore(first.store);
    const seen: Array<string | null> = [];
    switching.subscribe(() => seen.push(switching.get().activePanelId));

    expect(switching.get().activePanelId).toBe("first");
    switching.switchTo(second.store);
    expect(switching.get().activePanelId).toBe("second");
    expect(switching.current()).toBe(second.store);
    expect(seen.at(-1)).toBe("second");
  });

  it("writes through to the active store", () => {
    const first = make("first");
    const second = make("second");
    const switching = createSwitchingStore(first.store);
    switching.switchTo(second.store);
    switching.update((state) => ({ ...state, activePanelId: "written" }));
    expect(second.store.get().activePanelId).toBe("written");
    expect(first.store.get().activePanelId).toBe("first");
  });

  it("wakes subscribers when the active store changes on its own", () => {
    const first = make("first");
    const switching = createSwitchingStore(first.store);
    let seen = 0;
    switching.subscribe(() => seen++);
    switching.update((state) => ({ ...state, activePanelId: "changed" }));
    expect(seen).toBe(1);
  });
});
