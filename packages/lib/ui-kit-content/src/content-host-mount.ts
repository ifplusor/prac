/**
 * Mount a `ContentHost` into a layout item's element.
 *
 * @module prac-ui-kit-content/content-host-mount
 */

import { createElement, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ContentHost } from "./content.js";

/** Mount one `ContentHost` into the layout item's box. */
export function ContentHostMount({
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
