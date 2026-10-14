/**
 * The stack allocation, tested as the arithmetic it is.
 *
 * `allocateStack` turns the sizes people dragged and the folds they clicked into the heights a
 * stack draws. The gates cover the interactions end to end; these cover the rules themselves —
 * including "growing with nothing below takes room from above", which no gate could pin down
 * (a synthetic drag loses its last steps, so the amount it moves is not reproducible).
 *
 * It lives in `model.ts` because `frame.ts` pulls in the store/DOM and cannot be imported by a
 * unit test at all (measured: `Cannot find package 'zustand'`).
 */
import { describe, expect, it } from "vite-plus/test";
import type { LayoutState } from "./contract.js";
import { HEADER_HEIGHT, MIN_ENTRY, allocateStack } from "./model.js";

const HEIGHT = 734;

/** A state with just the view records `allocateStack` reads. */
const stateOf = (views: Record<string, { size?: number; collapsed?: boolean }>): LayoutState =>
  ({ views }) as unknown as LayoutState;

const heights = (views: readonly string[], drawn: ReadonlyMap<string, number>): number[] =>
  views.map((viewId) => drawn.get(viewId) ?? 0);

describe("allocateStack", () => {
  it("shares the height equally when nobody has sized anything", () => {
    const views = ["a", "b", "c"];
    const drawn = allocateStack(views, stateOf({ a: {}, b: {}, c: {} }), new Map(), 300);
    expect(heights(views, drawn)).toEqual([100, 100, 100]);
  });

  it("keeps the sizes people set and lets the rest share what is left", () => {
    const views = ["a", "b", "c", "d"];
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 400 }, b: {}, c: {}, d: {} }),
      new Map(),
      HEIGHT,
    );
    expect(drawn.get("a")).toBe(400);
    for (const viewId of ["b", "c", "d"]) {
      expect(drawn.get(viewId) ?? 0).toBeGreaterThanOrEqual(MIN_ENTRY);
    }
    expect(heights(views, drawn).reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(
      HEIGHT,
    );
  });

  it("scales sizes that cannot all fit, and never below the floor", () => {
    const views = ["a", "b", "c", "d", "e"];
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 600 }, b: { size: 600 }, c: {}, d: {}, e: {} }),
      new Map(),
      HEIGHT,
    );
    expect(drawn.get("a") ?? 0).toBeLessThan(600);
    expect(drawn.get("b") ?? 0).toBeLessThan(600);
    for (const viewId of views) {
      expect(drawn.get(viewId) ?? 0).toBeGreaterThanOrEqual(MIN_ENTRY);
    }
  });

  it("gives a folded bottom entry's room to the entries above it", () => {
    const views = ["a", "b", "c", "d"];
    const measured = new Map([
      ["b", 100],
      ["c", 100],
    ]);
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 300 }, b: {}, c: {}, d: { collapsed: true } }),
      measured,
      HEIGHT,
    );
    expect(drawn.get("d")).toBe(HEADER_HEIGHT);
    expect(drawn.get("a") ?? 0).toBeGreaterThan(300);
    expect(drawn.get("b") ?? 0).toBeGreaterThan(100);
    expect(drawn.get("c") ?? 0).toBeGreaterThan(100);
    expect(heights(views, drawn).reduce((total, size) => total + size, 0)).toBe(HEIGHT);
  });

  it("gives a folded middle entry's room to the entries below it", () => {
    const views = ["a", "b", "c", "d"];
    const measured = new Map([
      ["c", 100],
      ["d", 100],
    ]);
    const drawn = allocateStack(
      views,
      stateOf({ a: { size: 300 }, b: { collapsed: true }, c: {}, d: {} }),
      measured,
      HEIGHT,
    );
    expect(drawn.get("b")).toBe(HEADER_HEIGHT);
    expect(drawn.get("a")).toBe(300);
    expect(drawn.get("c") ?? 0).toBeGreaterThan(100);
    expect(drawn.get("d") ?? 0).toBeGreaterThan(100);
  });
});
