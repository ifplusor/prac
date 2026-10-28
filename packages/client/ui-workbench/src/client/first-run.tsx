/**
 * The first-run surface: no project folder yet.
 *
 * It renders only when the page has no `?workspace=` — the shell's stage,
 * window group and chat stay absent until a project folder is chosen. The
 * recent list comes from the same Workspace controller the title bar uses.
 *
 * @module prac-web-app/client/first-run
 */

import { createElement, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { PracTitleFace } from "./title-bar.tsx";

/** First-run styling; the tokens are DSH's. */
export const PRAC_FIRST_RUN_CSS = `
[data-prac-firstrun]{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
.prac-firstrun-card{width:min(540px,calc(100vw - 48px));padding:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 24px 80px rgba(0,0,0,.28);}
.prac-firstrun-brand{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-weight:700;font-size:16px;margin-bottom:14px;}
.prac-firstrun-title{margin:0 0 6px;font-size:18px;font-weight:600;}
.prac-firstrun-sub{margin:0 0 20px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);}
.prac-firstrun-label{margin:14px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary);}
.prac-firstrun-recent{display:flex;flex-direction:column;gap:4px;}
.prac-firstrun-row{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer;}
.prac-firstrun-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.prac-firstrun-row b{font-size:12px;font-weight:600;}
.prac-firstrun-row span{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);}
.prac-firstrun-empty{padding:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);}
.prac-firstrun-row-input{display:flex;gap:6px;}
.prac-firstrun-input{flex:1 1 auto;min-width:0;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;}
.prac-firstrun-button{padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;font-size:12px;cursor:pointer;}
.prac-firstrun-button:hover{background:var(--dsw-alias-interactive-bg-hover);}
.prac-firstrun-error{margin-top:10px;font-size:11px;color:var(--dsw-alias-state-error-primary);}
`;

/**
 * Render the first-run surface when no project folder is selected.
 *
 * @param props - the title face (recent Workspaces + open-folder action).
 * @returns the overlay, or null once a project folder is present.
 */
export function PracFirstRun({ face }: { face: PracTitleFace }): ReactElement | null {
  const workspaces = useSyncExternalStore(
    (listener) => face.workspaces.list.subscribe(listener),
    () => face.workspaces.list.getSnapshot(),
  );
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams(window.location.search);
  if (params.get("workspace") !== null) return null;
  const open = (path: string): void => {
    const target = path.trim();
    if (target === "") {
      setError("先填一个路径。");
      return;
    }
    face.openWorkspaceFolder(target);
  };
  return createElement(
    "div",
    { className: "prac-firstrun", "data-prac-firstrun": "" },
    createElement(
      "div",
      { className: "prac-firstrun-card" },
      createElement("div", { className: "prac-firstrun-brand" }, "p"),
      createElement("h1", { className: "prac-firstrun-title" }, "Open a project"),
      createElement(
        "p",
        { className: "prac-firstrun-sub" },
        "prac 是 workspace 范围内的 OS-like 工作台；先选一个 project folder。",
      ),
      workspaces.items.length > 0
        ? createElement(
            "div",
            { className: "prac-firstrun-recent" },
            createElement("div", { className: "prac-firstrun-label" }, "最近"),
            ...workspaces.items.map((workspace) =>
              createElement(
                "button",
                {
                  key: workspace.workspaceId,
                  type: "button",
                  className: "prac-firstrun-row",
                  onClick: () => open(workspace.path),
                },
                createElement("b", null, workspace.title),
                createElement("span", null, workspace.path),
              ),
            ),
          )
        : createElement(
            "div",
            { className: "prac-firstrun-empty" },
            "还没有最近 workspace；打开一个 folder。",
          ),
      createElement(
        "div",
        { className: "prac-firstrun-open" },
        createElement("div", { className: "prac-firstrun-label" }, "打开文件夹"),
        createElement(
          "div",
          { className: "prac-firstrun-row-input" },
          createElement("input", {
            className: "prac-firstrun-input",
            value: folder,
            placeholder: "/path/to/project",
            onChange: (event) => {
              setFolder(event.currentTarget.value);
              setError(null);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter") open(folder);
            },
          }),
          createElement(
            "button",
            { type: "button", className: "prac-firstrun-button", onClick: () => open(folder) },
            "打开",
          ),
        ),
      ),
      error === null ? null : createElement("div", { className: "prac-firstrun-error" }, error),
    ),
  );
}
