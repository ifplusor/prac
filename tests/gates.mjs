/**
 * The live acceptance roster.
 *
 * One source of truth for the gate names: `tests/ui.mjs` runs them, the CLI
 * (`tests/run.mjs list|gate`) reads them, and `PRAC_GATES` selects a subset by
 * these names.
 */
export const GATES = [
  ["containers", "tests/gates/verify-containers.mjs"],
  ["board", "tests/gates/verify-board.mjs"],
  ["stack", "tests/gates/verify-stack.mjs"],
  ["split", "tests/gates/verify-split.mjs"],
  ["grid", "tests/gates/verify-grid.mjs"],
  ["grid:resize", "tests/gates/verify-grid-resize.mjs"],
  ["grid:merge", "tests/gates/verify-grid-merge.mjs"],
  ["grid:view", "tests/gates/verify-grid-view.mjs"],
  ["grid:tab", "tests/gates/verify-grid-tab.mjs"],
  ["grid:free", "tests/gates/verify-grid-free-resize.mjs"],
  ["resize", "tests/gates/verify-resize.mjs"],
  ["persistence", "tests/gates/verify-persistence.mjs"],
  ["space", "tests/gates/verify-space.mjs"],
  ["bottom", "tests/gates/verify-bottom.mjs"],
  ["views", "tests/gates/verify-views.mjs"],
  ["file", "vendor/vscode/scripts/verify-file.mjs"],
  ["editor:group", "vendor/vscode/scripts/verify-group.mjs"],
  ["editor:close", "vendor/vscode/scripts/verify-close.mjs"],
  ["tabs", "vendor/vscode/scripts/verify-tabs.mjs"],
  ["dynamic", "tests/gates/verify-dynamic.mjs"],
  ["switch-cost", "tests/gates/verify-switch-cost.mjs"],
  ["multitab", "tests/gates/verify-multitab.mjs"],
  ["workspace-state", "tests/gates/verify-workspace-state.mjs"],
  ["folder-switch", "tests/gates/verify-folder-switch.mjs"],
];

/**
 * Named subsets for the inner loop.
 *
 * `vp run verify:ui -- smoke` runs only these; a name may be a gate or a group.
 * Keep them small: this is the loop a change is iterated on, the full roster is
 * the baseline before a commit.
 */
export const GROUPS = {
  /** Frame basics: a surface, the catalogue, a split, the tab strip. */
  smoke: ["stack", "views", "split", "tabs"],
  /** The editor path: the slow gate plus the two group checks. */
  editor: ["file", "editor:group", "editor:close"],
  /** Grid placement and resize. */
  grid: ["grid", "grid:resize", "grid:merge", "grid:view", "grid:tab", "grid:free"],
};
