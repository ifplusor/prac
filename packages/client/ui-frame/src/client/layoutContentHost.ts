/**
 * Imperative content host adapter.
 *
 * Window content that is not a React slot (editor / chat / board host) mounts
 * itself into this element. The frame only supplies the element; the source owns
 * the host lifecycle.
 *
 * @module prac-client-ui-frame/client/layoutContentHost
 */
import { createElement, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ContentHost } from "./windowModel.js";

/** Mount one `ContentHost` into the layout item's box. */
export function ContentHostView({
  host,
  contentId,
}: {
  readonly host: ContentHost;
  readonly contentId: string;
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    host.mount(element);
    return () => host.release();
  }, [host]);
  return createElement("div", {
    ref,
    "data-prac-content-host": contentId,
    style: { display: "flex", flex: "1 1 auto", minWidth: 0, minHeight: 0 },
  });
}
