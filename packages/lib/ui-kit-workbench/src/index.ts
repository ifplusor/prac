/**
 * `prac-ui-kit-workbench`: prac's frame layout engine as a library.
 *
 * The product model (region tree, item table, board roots), region content and
 * the frame binding. The generic renderer / chrome live in `prac-ui-kit-content`. It has **no DSH dependency and no plugin lifecycle**:
 * the frame plugin owns the DSH store, the slot catalogue and the
 * `SlotMap` / `Context` merges, and wires this engine to them.
 *
 * @module prac-ui-kit-workbench
 */

export * from "./contract.js";
export * from "./model.js";
export * from "./store.js";
export * from "./region-bindings.js";
export * from "./group-bridge.js";
export * from "./public.js";
export * from "./region-content.js";
export * from "./frame-state.js";
export * from "./layout-root.js";
export * from "./workbench-model.js";
export * from "./window-group-model.js";
export * from "./applications.js";
export * from "./content-host-registry.js";
export * from "./board-layouts.js";
export * from "./layout-drop.js";
export * from "./probes.js";
