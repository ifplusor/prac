# File Naming

Prac uses one file naming convention for source code and package subpaths.

## Rules

| Kind                           | Convention                           | Example                   |
| ------------------------------ | ------------------------------------ | ------------------------- |
| npm package                    | kebab-case                           | `prac-ui-kit-content`     |
| directory                      | kebab-case                           | `window-group/`           |
| TypeScript / JavaScript module | kebab-case                           | `workbench-model.ts`      |
| single-component `.tsx`        | kebab-case (current repo)            | `title-bar.tsx`           |
| test                           | same stem as the module + `.spec.ts` | `workbench-model.spec.ts` |
| public subpath                 | kebab-case                           | `./content-host-mount`    |
| type / class / component       | PascalCase                           | `WindowGroup`             |
| function / variable            | camelCase                            | `createWindowGroup`       |
| constant                       | UPPER_SNAKE_CASE                     | `DEFAULT_MIN`             |

The symbol names stay idiomatic TypeScript; only the file and subpath names are normalized.

## Enforcement

`unicorn/filename-case` (via Vite+ / Oxlint) enforces kebab-case in the root
`vite.config.ts`. `vp check` and `vp lint` run it for the whole repository.

`vendor/**` is excluded from this rule: those files mirror upstream VS Code
overlays and keep their upstream names.

## Boundaries

- Package names, directories, TS modules, specs and public subpaths use kebab-case.
- Symbol declarations keep their language naming: PascalCase for types / classes /
  components, camelCase for functions / variables, UPPER_SNAKE_CASE for constants.
- New files must use the convention; existing files are renamed in mechanical,
  package-scoped commits rather than mixed into behavior changes.
