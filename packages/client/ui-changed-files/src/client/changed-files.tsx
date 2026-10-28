/**
 * prac's changed-files card for the conversation turn tail.
 *
 * It reads the DSH `workspace/changes` announcement from the turn's
 * `deliverables` data, loads the summary from the Host route, and opens the
 * turn-scoped diff text through the prac VSCode face. The DSH card is hidden by
 * the arrangement's style; this card owns the row action, not a review tab.
 *
 * @module prac-web-app/client/changed-files
 */

import { createElement, useEffect, useState } from "react";
import type { ReactElement } from "react";

/** One row of the Host summary; mirrors the served `/api/changes.summary` shape. */
interface ChangedFile {
  path: string;
  display: string;
  added: number;
  deleted: number;
  binary?: true;
  oversized?: true;
}

interface Summary {
  turn: number;
  files: ChangedFile[];
  total: number;
  added: number;
  deleted: number;
}

/** The turn data this card reads; `ui-deliverables` publishes it. */
interface DeliverablesData {
  changes?: { seq: number };
}

/** Session state shape; only the cwd is read. */
interface SessionState {
  byId: Record<string, { cwd?: string } | undefined>;
}

/** The face the arrangement injects. */
export interface ChangedFilesInjected {
  /** Open a turn-scoped diff editor for two in-memory strings. */
  openTurnDiff(args: {
    before: string;
    after: string;
    title: string;
    language: string;
  }): Promise<unknown>;
}

/** The slot's props that this card actually uses. */
export interface ChangedFilesProps {
  sessionId: string;
  useSessions(selector: (state: SessionState) => string | undefined): string | undefined;
  useChat<T>(selector: (state: { timeline: { turnOrder: readonly number[] } }) => T): T;
  turn: { turn?: number; data: { get(key: string): unknown } };
}

type Props = ChangedFilesProps & ChangedFilesInjected;

function summaryUrl(sessionId: string, seq: number): string {
  return `api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}`;
}

function diffUrl(sessionId: string, seq: number, index: number): string {
  return `api/prac-turn-diff.text?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })}`;
}

/** Map a path to a VS Code language id for the diff. */
function languageOf(path: string): string {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx") || path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

function isSummary(value: unknown): value is Summary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(candidate.turn) &&
    Number.isSafeInteger(candidate.total) &&
    Number.isSafeInteger(candidate.added) &&
    Number.isSafeInteger(candidate.deleted) &&
    Array.isArray(candidate.files)
  );
}

/**
 * The turn-tail card. It renders nothing for a turn without a change
 * announcement, or once the Host no longer serves the summary.
 */
export function PracChangedFiles(props: Props): ReactElement | null {
  const data = props.turn.data.get("deliverables") as DeliverablesData | undefined;
  const seq = data?.changes?.seq;
  const cwd = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
  const latestTurn = props.useChat((state) => state.timeline.turnOrder.at(-1));
  const [summary, setSummary] = useState<Summary | "missing" | "loading">("loading");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seq === undefined) return;
    let cancelled = false;
    setSummary("loading");
    fetch(summaryUrl(props.sessionId, seq))
      .then(async (response) => {
        if (!response.ok) return "missing" as const;
        const value: unknown = await response.json();
        return isSummary(value) ? value : ("missing" as const);
      })
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => {
        if (!cancelled) setSummary("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [props.sessionId, seq]);

  if (seq === undefined || summary === "loading" || summary === "missing") return null;
  if (latestTurn !== undefined && props.turn.turn !== undefined && latestTurn !== props.turn.turn)
    return null;
  if (summary.files.length === 0) return null;

  const open = async (index: number, file: ChangedFile): Promise<void> => {
    if (file.binary === true || file.oversized === true || busy !== null) return;
    setBusy(index);
    setError(null);
    try {
      const response = await fetch(diffUrl(props.sessionId, seq, index));
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof value !== "object" || value === null) {
        setError("这一轮的 diff 暂时不可用。");
        return;
      }
      const payload = value as { kind?: string; before?: string | null; after?: string | null };
      if (payload.kind !== "text") {
        setError(
          payload.kind === "binary" ? "二进制文件没有文本 diff。" : "这一轮的 diff 暂时不可用。",
        );
        return;
      }
      await props.openTurnDiff({
        before: payload.before ?? "",
        after: payload.after ?? "",
        title: `Turn ${summary.turn} · ${file.display}`,
        language: languageOf(file.path),
      });
    } catch {
      setError("打开 diff 失败。");
    } finally {
      setBusy(null);
    }
  };

  return createElement(
    "div",
    { className: "prac-changed-files", "data-prac-changed-files": "", "data-turn": summary.turn },
    createElement(
      "div",
      { className: "prac-cf-head" },
      createElement("span", { className: "prac-cf-icon", "aria-hidden": "true" }, "±"),
      createElement("span", { className: "prac-cf-title" }, `${summary.total} files changed`),
      createElement(
        "span",
        { className: "prac-cf-total" },
        createElement("span", { className: "prac-cf-add" }, `+${summary.added}`),
        createElement("span", { className: "prac-cf-del" }, `−${summary.deleted}`),
      ),
    ),
    createElement(
      "div",
      { className: "prac-cf-list" },
      summary.files.map((file, index) =>
        createElement(
          "button",
          {
            key: file.path,
            type: "button",
            className: "prac-cf-row",
            disabled: file.binary === true || file.oversized === true || busy !== null,
            title: cwd === undefined ? file.path : `${cwd}/${file.path}`,
            onClick: () => {
              void open(index, file);
            },
          },
          createElement("span", { className: "prac-cf-path" }, file.display),
          createElement(
            "span",
            { className: "prac-cf-stat" },
            file.binary === true
              ? "binary"
              : file.oversized === true
                ? "oversized"
                : `${busy === index ? "…" : `+${file.added} −${file.deleted}`}`,
          ),
        ),
      ),
    ),
    createElement(
      "div",
      { className: "prac-cf-foot" },
      createElement("span", { className: "prac-cf-turn" }, `Turn ${summary.turn}`),
      createElement(
        "span",
        { className: "prac-cf-note" },
        error ?? "before / after snapshot · click a file to open the diff",
      ),
    ),
    createElement(
      "div",
      { className: "prac-cf-foot", "data-prac-review": "" },
      createElement("span", { className: "prac-cf-turn" }, "review"),
      createElement(
        "span",
        { className: "prac-cf-note" },
        "checks 是 shell / tool calls · chat 里说 request changes / approve · human edit / git revert",
      ),
    ),
  );
}
