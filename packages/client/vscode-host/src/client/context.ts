/**
 * Container-context projection.
 *
 * Container title actions and container context keys belong to the container the
 * view group is bound to. A view's own actions and `viewsWelcome` follow the
 * view; the source container they were declared in does not follow them when the
 * frame moves the view into a plain group.
 *
 * This module resolves the **container** half only. It deliberately does not
 * decide private view actions or welcome state.
 *
 * @module prac-client-vscode-host/client/context
 */

import type { VscodeGroupBinding, VscodeView } from "./resources.js";

/** How the effective container context was obtained. */
export type ContainerContextMode = "group" | "unbound";

/** The container context a view should actually see. */
export interface ResolvedContainerContext {
  /** The container the view was declared in; kept for diagnostics. */
  readonly sourceContainerId?: string;
  /** The container whose context applies; absent when unbound. */
  readonly effectiveContainerId?: string;
  readonly mode: ContainerContextMode;
}

/**
 * Resolve the container context for one view in one view group.
 *
 * Rules:
 * - a group with a container binding supplies the effective container;
 * - a plain group has no effective container, even if the view was declared in
 *   one — the old container context does not follow the view;
 * - the source container is retained as metadata, not as effective context.
 */
export function resolveContainerContext(
  view: VscodeView,
  binding?: VscodeGroupBinding,
): ResolvedContainerContext {
  const sourceContainerId = view.spec.containerId;
  const effectiveContainerId = binding?.containerId;
  return effectiveContainerId === undefined
    ? { ...(sourceContainerId === undefined ? {} : { sourceContainerId }), mode: "unbound" }
    : {
        ...(sourceContainerId === undefined ? {} : { sourceContainerId }),
        effectiveContainerId,
        mode: "group",
      };
}
