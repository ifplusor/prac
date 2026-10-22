/**
 * Compose the VS Code concrete definitions with the published face.
 *
 * This is the seam between the pure resource definitions and the live app: the
 * face supplies mount/release/focus and container actions, while the caller
 * supplies the core runtime factories. The frame still owns placement.
 *
 * @module prac-client-vscode-host/client/adapter
 */

import type { PracVscodeAction } from "./public.js";
import {
  VscodeGroupBinding,
  VscodeViewDefinition,
  VscodeViewGroupDefinition,
  createVscodeViewHost,
  type VscodeGroupFactory,
  type VscodeViewFactory,
} from "./resources.js";

/** The face operations the concrete definitions need. */
export interface VscodeFaceAdapter {
  mountView(view: string, element: HTMLElement): void;
  releaseView(view: string): void;
  focusView(view: string): void;
  containerActions(containerId: string): readonly PracVscodeAction[];
  runAction(containerId: string, actionId: string): void;
}

/** Inputs for the concrete definition composition. */
export interface VscodeResourceAdapterOptions {
  readonly face: VscodeFaceAdapter;
  readonly createGroup: VscodeGroupFactory;
  readonly createView: VscodeViewFactory;
}

/** The two concrete definitions, wired to one face. */
export interface VscodeResourceDefinitions {
  readonly groups: VscodeViewGroupDefinition;
  readonly views: VscodeViewDefinition;
}

/** Build the VS Code definitions from the live face and core runtime factories. */
export function createVscodeResourceDefinitions(
  options: VscodeResourceAdapterOptions,
): VscodeResourceDefinitions {
  const { face, createGroup, createView } = options;
  const groups = new VscodeViewGroupDefinition({
    createGroup,
    createBinding: (spec, groupId) => {
      const containerId = spec.containerId;
      if (containerId === undefined) return undefined;
      return new VscodeGroupBinding(groupId, spec.groupKind, {
        actions: () => face.containerActions(containerId),
        runAction: (actionId) => face.runAction(containerId, actionId),
      });
    },
  });
  const views = new VscodeViewDefinition({
    createView,
    createHost: (view) =>
      createVscodeViewHost(view, {
        mount: (appViewId, element) => face.mountView(`vscode:view:${appViewId}`, element),
        release: (appViewId) => face.releaseView(`vscode:view:${appViewId}`),
        focus: (appViewId) => face.focusView(`vscode:view:${appViewId}`),
      }),
  });
  return { groups, views };
}
