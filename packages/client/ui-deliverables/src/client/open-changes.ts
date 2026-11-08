/**
 * Open one changed file's turn-scoped comparison in prac's embedded VS Code
 * editor instead of the right-Sidebar review tab.
 *
 * This is the one behavioral diff from upstream `ui-deliverables`: the card,
 * delivery cards, mentions and the review tab are unchanged; only the card's
 * open action is redirected. The summary route and the Host's
 * `/api/prac-turn-diff.text` reader already exist, so this is a reader, not a
 * second recorder.
 *
 * @module prac-client-ui-deliverables/client/open-changes
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: augments `Context` with `pracVscode`.
import type {} from 'prac-client-vscode-host/client'
import {
  changesSummaryUrl,
  isChangesSummary,
  type ChangesReviewCoordinates,
} from '../changes.ts'

/** VS Code language id inferred from a changed file's path. */
function languageOf(path: string): string {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs')) return 'javascript'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml'
  return 'plaintext'
}

/** One file's complete turn-start / turn-end text, as the Host serves it. */
interface TurnDiffText {
  kind: 'text'
  before: string | null
  after: string | null
}

/** Whether a decoded `/api/prac-turn-diff.text` answer carries the two texts. */
function isTurnDiffText(value: unknown): value is TurnDiffText {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'text'
}

/**
 * Read the turn's summary, then the file's two sides, and open prac's diff.
 * @param ctx - client context carrying `pracVscode`.
 * @param coordinates - the Session, announcing event, and turn the card names.
 * @param index - the file's index in the summary's `files`.
 * @throws when a read fails or the file is binary/oversized; the caller falls
 *   back to the upstream review tab.
 */
export async function openChangesInEditor(
  ctx: ClientContext,
  coordinates: ChangesReviewCoordinates,
  index: number,
): Promise<void> {
  const { sessionId, seq, turn } = coordinates
  const summaryResponse = await fetch(changesSummaryUrl(sessionId, seq))
  if (!summaryResponse.ok) throw new Error('changed-files: summary unavailable')
  const summary: unknown = await summaryResponse.json()
  if (!isChangesSummary(summary)) throw new Error('changed-files: malformed summary')
  const file = summary.files[index]
  if (file === undefined || file.binary === true || file.oversized === true) {
    throw new Error('changed-files: file has no text comparison')
  }

  const url = `api/prac-turn-diff.text?${new URLSearchParams({
    sessionId,
    seq: String(seq),
    index: String(index),
  })}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('changed-files: turn diff unavailable')
  const value: unknown = await response.json()
  if (!isTurnDiffText(value)) throw new Error('changed-files: malformed turn diff')

  await ctx.pracVscode.runCommand('prac.openTurnDiff', {
    before: value.before ?? '',
    after: value.after ?? '',
    title: `Turn ${turn} · ${file.display}`,
    language: languageOf(file.path),
  })
}
