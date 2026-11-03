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
];
