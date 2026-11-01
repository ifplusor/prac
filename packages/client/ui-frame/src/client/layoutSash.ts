/**
 * Generic sash DOM.
 *
 * Position is the only thing this component owns: it overlays the boundary at
 * `offset`, measures the previous sibling, and forwards pointer down / double
 * click. The resize controller stays with the container (pointer capture, snap,
 * constraints), so frame and board can share the element without sharing policy.
 *
 * @module prac-client-ui-frame/client/layoutSash
 */
import { createElement, useLayoutEffect, useRef } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactElement } from "react";
import { SASH_SIZE, type Dir } from "./contract.js";

/** Inputs for one boundary. */
export interface LayoutSashProps {
  readonly splitId: string;
  readonly dir: Dir;
  readonly index: number;
  readonly leftId: string;
  readonly rightId: string;
  readonly offset: number;
  readonly stackState?: string;
  readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onDoubleClick: (event: MouseEvent<HTMLDivElement>) => void;
}

/** One draggable boundary between two adjacent regions. */
export function LayoutSash({
  splitId,
  dir,
  index,
  leftId,
  rightId,
  offset,
  stackState,
  onPointerDown,
  onDoubleClick,
}: LayoutSashProps): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const half = SASH_SIZE / 2;
  useLayoutEffect(() => {
    const element = ref.current;
    const previous = element?.previousElementSibling;
    const parent = element?.parentElement;
    if (!element || !previous || !parent) return;
    const parentBox = parent.getBoundingClientRect();
    const previousBox = previous.getBoundingClientRect();
    const drawn = dir === "row" ? previousBox.width > 0 : previousBox.height > 0;
    if (dir === "row") {
      element.style.left = drawn
        ? `${previousBox.right - parentBox.left - half}px`
        : `${offset - half}px`;
    } else {
      element.style.top = drawn
        ? `${previousBox.bottom - parentBox.top - half}px`
        : `${offset - half}px`;
    }
  });
  const style: CSSProperties =
    dir === "row"
      ? { left: offset - half, top: 0, bottom: 0, width: SASH_SIZE }
      : { top: offset - half, left: 0, right: 0, height: SASH_SIZE };
  return createElement("div", {
    "data-prac-sash": `${splitId}:${index}`,
    ref,
    onDoubleClick,
    "data-prac-sash-dir": dir,
    "data-prac-sash-left": leftId,
    "data-prac-sash-right": rightId,
    ...(stackState === undefined ? {} : { "data-prac-stack-sash-state": stackState }),
    "aria-hidden": "true",
    style,
    onPointerDown,
  });
}
