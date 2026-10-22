/**
 * The client half's **published type surface**.
 *
 * Types only: this module exists so the pack's dts pass emits a declaration
 * bundle for consumers (`prac-client-vscode-editor`, `prac-web-app`, …) to import
 * — the thing that lets them stop restating prac's names by hand. It must stay
 * free of runtime code (the emitted `.mjs` is a stub); the executable client half
 * is `index.ts`, wrapped by `scripts/pack-client.ts` into the loader artifact.
 *
 * Re-exporting from `contract.ts` is deliberate: that module declares prac's own
 * names (`SlotMap["prac.view"]`, `Context.pracLayout`) *and* pulls DSH's merges
 * into the program, and both must reach a consumer that imports these types.
 *
 * @module prac-client-ui-layout/client/public
 */

export type {
  Dir,
  LayoutState,
  LayoutFace,
  PracLayoutFace,
  RegionChild,
  RegionNode,
  RoleBindings,
  Side,
  SplitNode,
  ViewRecord,
} from "./contract.js";
export type { RegionInfo, ViewInfo } from "./catalogue.js";

// NOTE: no DSH type re-exports here. A consumer imports DSH's own types from DSH
// (single module identity); re-exporting them would inline those declarations into
// this bundle, and a second `SlotMap` means declaration merging lands in the copy
// the consumer's `ctx.slots` does not use — measured: the key type collapsed to
// `never`.

/**
 * The slot key a prac surface registers its view into (`prac.view`).
 *
 * Consumers name it once and let the compiler check it, instead of restating the
 * literal and the `SlotMap` row it needs.
 */
export type ViewSlotKey = typeof import("./catalogue.js").VIEW_SLOT;

// The CRD-lite mechanism and the core runtime shapes. Runtime constructors live
// in `client/index.ts`; this module exposes the types consumers may name.
export type {
  Diagnostic,
  GroupBinding,
  MaterializeContext,
  MaterializeOutcome,
  MaterializedResource,
  MoveIntent,
  ResourceEnvelope,
  ResourceMetadata,
  ResourcePhase,
  ViewDefinition,
  ViewGroupDefinition,
  ViewGroupResource,
  ViewGroupRuntime,
  ViewHost,
  ViewResource,
  ViewRuntime,
} from "./resource.js";
export type { FrameView, View } from "./view.js";
export type { ViewGroup, ViewGroupMode, ViewGroupPlacement, ViewGroupState } from "./viewGroup.js";
export type { MoveViewRequest } from "./move.js";

export type { ViewGroupLayoutBridge } from "./frameBridge.js";

export type { FrameGroup, FrameViewGroup, ViewGroupHost } from "./frameGroups.js";
