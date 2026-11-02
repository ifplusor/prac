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
export * from "./frameGroups.js";
export * from "./frameBridge.js";
export * from "./public.js";
export * from "./regionContent.js";
export * from "./frameState.js";
export * from "./layoutRoot.js";
export * from "./windowModel.js";
export * from "./windowGroupModel.js";
export * from "./contentHosts.js";
export * from "./boardLayouts.js";
export * from "./layoutActions.js";
export * from "./layoutContentHost.js";
export * from "./layoutDrop.js";
