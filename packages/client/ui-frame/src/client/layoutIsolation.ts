/**
 * Generic isolated view boundary.
 *
 * One host element + one shadow root per item; the frame owns the boundary, the
 * source owns the content. Board/item renderers use the same boundary.
 *
 * @module prac-client-ui-frame/client/layoutIsolation
 */
import { createElement, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { mountIsolated, releaseIsolated } from "./isolation.js";

/** Inputs for one isolated item. */
export interface LayoutIsolationProps {
  readonly children?: ReactNode;
  /** The box itself lets events pass; its entries opt back in (float layer). */
  readonly clickThrough?: boolean;
  /** When the frame owns the row title, hide the view's own duplicate collapse affordance. */
  readonly chrome?: "frame";
  /** The item this boundary hosts, for diagnostics and gates. */
  readonly viewId?: string;
}

/** Render one item behind its own isolation boundary. */
export function LayoutIsolation({
  children,
  clickThrough = false,
  chrome,
  viewId,
}: LayoutIsolationProps): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return undefined;
    setContent(mountIsolated(element));
    return () => {
      releaseIsolated(element);
      setContent(null);
    };
  }, []);
  return createElement(
    "div",
    {
      ref: host,
      "data-prac-view-host": "",
      ...(viewId === undefined ? {} : { "data-prac-view-id": viewId }),
      ...(chrome === "frame" ? { "data-prac-view-chrome": "frame" } : {}),
      style: {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minWidth: 0,
        minHeight: 0,
        ...(clickThrough ? { pointerEvents: "none" as const } : {}),
      },
    },
    content ? createPortal(children, content) : null,
  );
}
