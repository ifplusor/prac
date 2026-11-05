import { describe, expect, it } from "vite-plus/test";
import "./contract.js";
import { WIDGET_SLOT, viewSource } from "./catalogue.js";
import {
  catalogueViewIds,
  isDeclaredView,
  declaredViewLabel,
  declaredViewActionsFor,
  declaredViewPaneHeader,
  readDeclaredViewIds,
  viewKind,
} from "./catalogue.js";

/**
 * The catalogue is a *join* of two live registries, so its rules — what a view id
 * is made of, what order the ids are offered in, and what makes a view one the frame renders
 * view — are decisions, not rendering. The live gate keeps the half a browser
 * owns: that the surface renders exactly what this returns.
 */
type SlotEntry = {
  readonly options: {
    readonly key?: string;
    readonly id?: string;
    readonly label?: string;
    readonly icon?: string;
    readonly paneHeader?: boolean;
    readonly actions?: () => unknown;
  };
};

/**
 * A registry stand-in with one list per slot name.
 *
 * @param entries - slot name → that slot's entries.
 */
const registry = (
  entries: Record<string, readonly SlotEntry[]>,
): Parameters<typeof readDeclaredViewIds>[0] =>
  ({
    entries: (name: string) => entries[name] ?? [],
  }) as unknown as Parameters<typeof readDeclaredViewIds>[0];

describe("viewSource", () => {
  it("takes the source segment, and nothing when there is none", () => {
    expect(viewSource("dsh:sidebar")).toBe("dsh:");
    expect(viewSource("vscode:view:b")).toBe("vscode:");
    expect(viewSource("plain")).toBe("");
  });
});

describe("catalogueViewIds", () => {
  it("lists the declared items, sorted — not in registration order", () => {
    const slots = registry({
      main: [{ options: { key: "conversation" } }],
      [WIDGET_SLOT]: [{ options: { id: "vscode:view:b" } }, { options: { id: "vscode:view:a" } }],
    });
    expect(catalogueViewIds(slots)).toEqual(["vscode:view:a", "vscode:view:b"]);
  });

  it("collects the actions a declaration carries", () => {
    const action = (): null => null;
    const slots = registry({ [WIDGET_SLOT]: [{ options: { id: "act", actions: action } }] });
    readDeclaredViewIds(slots);
    expect(declaredViewActionsFor("act")).toBe(action);
    expect(declaredViewActionsFor("missing")).toBeUndefined();
  });

  it("is stable regardless of registration order", () => {
    const slots = registry({
      main: [{ options: { key: "beta" } }, { options: { key: "alpha" } }],
      [WIDGET_SLOT]: [{ options: { id: "z" } }, { options: { id: "a" } }],
    });
    expect(catalogueViewIds(slots)).toEqual(catalogueViewIds(slots));
    expect(catalogueViewIds(slots)).toEqual(["a", "z"]);
  });

  it("offers nothing from an empty registry", () => {
    expect(catalogueViewIds(registry({}))).toEqual([]);
  });
});

describe("readDeclaredViewIds / isDeclaredView", () => {
  it("takes membership from the slot registry, not from a name prefix", () => {
    readDeclaredViewIds(registry({ [WIDGET_SLOT]: [{ options: { id: "vscode:view:b" } }] }));
    expect(isDeclaredView("vscode:view:b")).toBe(true);
    // Same source, not registered: the prefix decides nothing.
    expect(isDeclaredView("vscode:view:a")).toBe(false);
    expect(isDeclaredView("dsh:sidebar")).toBe(false);
  });

  it("re-reads, so a view appearing or leaving is picked up", () => {
    readDeclaredViewIds(registry({ [WIDGET_SLOT]: [{ options: { id: "prac:notes" } }] }));
    expect(isDeclaredView("prac:notes")).toBe(true);
    readDeclaredViewIds(registry({}));
    expect(isDeclaredView("prac:notes")).toBe(false);
  });

  it("ignores an entry that declares no id", () => {
    const ids = readDeclaredViewIds(
      registry({ [WIDGET_SLOT]: [{ options: { id: "" } }, { options: { id: "prac:notes" } }] }),
    );
    expect([...ids]).toEqual(["prac:notes"]);
  });

  it("reads the declared title, and forgets it when the view leaves", () => {
    readDeclaredViewIds(
      registry({
        [WIDGET_SLOT]: [{ options: { id: "vscode:view:outline", label: "Outline" } }],
      }),
    );
    expect(declaredViewLabel("vscode:view:outline")).toBe("Outline");
    readDeclaredViewIds(registry({}));
    expect(declaredViewLabel("vscode:view:outline")).toBeUndefined();
  });

  it("reads whether a view brings its own pane header, and forgets it when it leaves", () => {
    readDeclaredViewIds(
      registry({
        [WIDGET_SLOT]: [
          { options: { id: "vscode:view:outline", paneHeader: true } },
          { options: { id: "prac:notes" } },
        ],
      }),
    );
    expect(declaredViewPaneHeader("vscode:view:outline")).toBe(true);
    // Absent is not "false by source": a view without the declaration has no header.
    expect(declaredViewPaneHeader("prac:notes")).toBe(false);
    readDeclaredViewIds(registry({}));
    expect(declaredViewPaneHeader("vscode:view:outline")).toBe(false);
  });
});

describe("viewKind", () => {
  it("lets a declaration win over the id's source segment", () => {
    readDeclaredViewIds(registry({ [WIDGET_SLOT]: [{ options: { id: "dsh:declared" } }] }));
    // The producer owns its ids; a `dsh:` prefix is not a dispatch rule.
    expect(viewKind("dsh:declared")).toBe("declared");
    expect(viewKind("dsh:sidebar")).toBe("unknown");
    expect(viewKind("vscode:view:outline")).toBe("unknown");
    readDeclaredViewIds(registry({}));
  });
});
