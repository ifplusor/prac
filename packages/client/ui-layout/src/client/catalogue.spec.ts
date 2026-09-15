import { describe, expect, it } from "vite-plus/test";
import type { Context } from "@deepseek-ai/cordis";
import {
  DSH_CONVERSATION_KEY,
  VIEW_SEAT,
  catalogueViewIds,
  isSeatView,
  readSeatViewIds,
  viewSource,
} from "./catalogue.js";

/**
 * The catalogue is a *join* of two live registries, so its rules — what a view id
 * is made of, what order the ids are offered in, and what makes a view a seat
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
    expect(viewSource("vscode:editor")).toBe("vscode:");
    expect(viewSource("plain")).toBe("");
  });
});

describe("catalogueViewIds", () => {
  it("lists DSH's own slots around the live main keys, then the seat", () => {
    const slots = registry({
      main: [
        { options: { key: DSH_CONVERSATION_KEY } },
        { options: { key: "alpha" } },
        // A main entry with no key is not a view: it has no id to offer.
        { options: {} },
      ],
      [VIEW_SEAT]: [{ options: { id: "vscode:editor" } }, { options: { id: "vscode:sidebar" } }],
    });
    expect(catalogueViewIds(slots)).toEqual([
      "dsh:sidebar",
      "dsh:main:alpha",
      `dsh:main:${DSH_CONVERSATION_KEY}`,
      "dsh:rightbar",
      "vscode:editor",
      "vscode:sidebar",
    ]);
  });

  it("is stable regardless of registration order", () => {
    const slots = registry({
      main: [{ options: { key: "beta" } }, { options: { key: "alpha" } }],
      [VIEW_SEAT]: [{ options: { id: "z" } }, { options: { id: "a" } }],
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

describe("readSeatViewIds / isSeatView", () => {
  it("takes membership from the seat registry, not from a name prefix", () => {
    readSeatViewIds(registry({ [VIEW_SEAT]: [{ options: { id: "vscode:editor" } }] }));
    expect(isSeatView("vscode:editor")).toBe(true);
    // Same source, not registered: the prefix decides nothing.
    expect(isSeatView("vscode:sidebar")).toBe(false);
    expect(isSeatView("dsh:sidebar")).toBe(false);
  });

  it("re-reads, so a view appearing or leaving is picked up", () => {
    readSeatViewIds(registry({ [VIEW_SEAT]: [{ options: { id: "prac:notes" } }] }));
    expect(isSeatView("prac:notes")).toBe(true);
    readSeatViewIds(registry({}));
    expect(isSeatView("prac:notes")).toBe(false);
  });

  it("ignores an entry that declares no id", () => {
    const ids = readSeatViewIds(
      registry({ [VIEW_SEAT]: [{ options: { id: "" } }, { options: { id: "prac:notes" } }] }),
    );
    expect([...ids]).toEqual(["prac:notes"]);
  });
});
