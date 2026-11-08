# prac-client-ui-deliverables

A vendored copy of `@deepseek-ai/dsh-client-ui-deliverables` at **0.2.1-alpha.2**
(the `dsh-prac-dev` anchor), kept under `packages/` instead of `vendor/` because
it is built and composed like every other prac client package.

## Why it exists

Upstream's changed-files card hardcodes its open action inside the plugin:
`openChangesReview` calls `ctx.sidebarRight.openResource(...)`. DSH exposes no
seam to redirect that to prac's embedded VS Code diff, and the published
artifact ships only `lib/`, not the card component. So prac owns this leaf.

This is the one deliberate exception to "不 fork 上游" in
[`tech-architecture`](../../../.agents/notes/in-progress/2026-11-05-tech-architecture.md);
the core stays pinned and compared.

## The diff from upstream

- `src/client/index.ts`: `openChangesReview` calls `openChangesInEditor`
  ([`open-changes.ts`](src/client/open-changes.ts)) instead of the review tab;
  `pracVscode` joins the client's `inject` list.
- `src/client/open-changes.ts`: new. Reads the summary and
  `/api/prac-turn-diff.text`, then runs `prac.openTurnDiff`. On any failure it
  falls back to the upstream review tab so the card still works.
- `src/client/index.ts` / `src/client/review-definition.ts`: the slot id and the
  review-tab id are prefixed `prac-` so the copy can never collide with the
  upstream registration. The review tab itself is retained for restored tabs.
- Package/build plumbing (`package.json`, `tsconfig.json`, `vite.config.ts`,
  `css-modules.d.ts`): prac's conventions.

Everything else is upstream's file, verbatim.

## Keeping it in sync

Re-copy `src/` from the anchor, then re-apply the diff above. `vp check` and the
`check:client` task catch type/artifact drift; behavior drift is what a re-copy
is for.
