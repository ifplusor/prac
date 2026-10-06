import { describe, expect, it } from "vite-plus/test";
import type { Context } from "@deepseek-ai/cordis";
import {
  DSH_CONVERSATION_KEY,
  VIEW_SLOT,
  catalogueViewIds,
  isDeclaredView,
  readDeclaredViewIds,
  viewSource,
} from "./catalogue.js";

/**
 * The catalogue is a *join* of two live registries, so its rules — what a view id
 * is made of, what order the ids are offered in, and what makes a view one the frame renders
 * view — are decisions, not rendering. The live gate keeps the half a browser
 * owns: that the surface renders exactly what this returns.
 */
type SlotEntry = { readonly options: { readonly key?: string; readonly id?: string } };

/**
 * A registry stand-in with one list per slot name.
 *
 * @param entries - slot name → that slot's entries.
 */
const registry = (entries: Record<string, readonly SlotEntry[]>): Context["slots"] =>
  ({ entries: (name: string) => entries[name] ?? [] }) as unknown as Context["slots"];

describe("viewSource", () => {
  it("takes the source segment, and nothing when there is none", () => {
    expect(viewSource("dsh:sidebar")).toBe("dsh:");
    expect(viewSource("vscode:view:b")).toBe("vscode:");
    expect(viewSource("plain")).toBe("");
  });
});

describe("catalogueViewIds", () => {
  it("lists DSH's own slots around the live main keys, then the declared views", () => {
    const slots = registry({
      main: [
        { options: { key: DSH_CONVERSATION_KEY } },
        { options: { key: "alpha" } },
        // A main entry with no key is not a view: it has no id to offer.
        { options: {} },
      ],
      [VIEW_SLOT]: [{ options: { id: "vscode:view:b" } }, { options: { id: "vscode:view:a" } }],
    });
    expect(catalogueViewIds(slots)).toEqual([
      "dsh:sidebar",
      "dsh:main:alpha",
      `dsh:main:${DSH_CONVERSATION_KEY}`,
      "dsh:rightbar",
      // Declared views come last, sorted — not in registration order.
      "vscode:view:a",
      "vscode:view:b",
    ]);
  });

  it("is stable regardless of registration order", () => {
    const slots = registry({
      main: [{ options: { key: "beta" } }, { options: { key: "alpha" } }],
      [VIEW_SLOT]: [{ options: { id: "z" } }, { options: { id: "a" } }],
    });
    expect(catalogueViewIds(slots)).toEqual(catalogueViewIds(slots));
    expect(catalogueViewIds(slots)).toEqual([
      "dsh:sidebar",
      "dsh:main:alpha",
      "dsh:main:beta",
      "dsh:rightbar",
      "a",
      "z",
    ]);
  });

  it("offers nothing from an empty registry but DSH's fixed slots", () => {
    expect(catalogueViewIds(registry({}))).toEqual(["dsh:sidebar", "dsh:rightbar"]);
  });
});

describe("readDeclaredViewIds / isDeclaredView", () => {
  it("takes membership from the slot registry, not from a name prefix", () => {
    readDeclaredViewIds(registry({ [VIEW_SLOT]: [{ options: { id: "vscode:view:b" } }] }));
    expect(isDeclaredView("vscode:view:b")).toBe(true);
    // Same source, not registered: the prefix decides nothing.
    expect(isDeclaredView("vscode:view:a")).toBe(false);
    expect(isDeclaredView("dsh:sidebar")).toBe(false);
  });

  it("re-reads, so a view appearing or leaving is picked up", () => {
    readDeclaredViewIds(registry({ [VIEW_SLOT]: [{ options: { id: "prac:notes" } }] }));
    expect(isDeclaredView("prac:notes")).toBe(true);
    readDeclaredViewIds(registry({}));
    expect(isDeclaredView("prac:notes")).toBe(false);
  });

  it("ignores an entry that declares no id", () => {
    const ids = readDeclaredViewIds(
      registry({ [VIEW_SLOT]: [{ options: { id: "" } }, { options: { id: "prac:notes" } }] }),
    );
    expect([...ids]).toEqual(["prac:notes"]);
  });
});
