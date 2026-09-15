/**
 * prac-client-vscode-host — prac's row onto the embedded VS Code app.
 *
 * The mechanism (boot once per page, part hosts, theme copying, the app's command
 * namespace) lives in `prac-vscode-embed/client`. What lives here is prac's
 * policy, and nothing about placement:
 *
 * 1. **when the app may boot** — only once DSH reports a workspace, because the
 *    workspace is the window's identity and that identity is fixed for the life
 *    of the page;
 * 2. **which part backs which view** — the seat packages declare views, and the
 *    part map here is what turns a view into the part the app mounts;
 * 3. **the face** — published on the DSH service registry, which is what makes
 *    `inject: ["pracVscode"]` keep a seat pending until the mechanism is there.
 *
 * The seats are declared by the seat packages (`prac-client-ui-vscode-editor`,
 * `prac-client-ui-vscode-explorer`), and *where* each seat goes is the
 * arrangement's (`prac-web-app`).
 *
 * The file is a plugin body as an ordinary ESM module (`name`, `inject`,
 * `apply`) plus exports the seat packages import. DSH's closure-factory artifact
 * (`window.__ModuleLoader__.load`) is produced by the `pack` config in
 * `vite.config.ts` (`scripts/pack-client.ts`); only `react` stays external.
 *
 * @module prac-client-vscode-host/client
 */

import type { ReactElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { createVscodeEmbed } from "prac-vscode-embed/client";
import type { PracVscodeFace } from "./public.js";

/** Same-origin prefix the host half serves the app bundle under. */
const VSCODE_ROUTE = "/prac-vscode";

/** The VS Code part behind the editor seat. */
export const EDITOR_PART = "workbench.parts.editor";
/** The VS Code part behind the explorer seat (the sidebar hosts it). */
export const SIDEBAR_PART = "workbench.parts.sidebar";

/** The view id of the editor seat, declared by `prac-client-ui-vscode-editor`. */
export const VSCODE_EDITOR_VIEW = "vscode:editor";
/** The view id of the explorer seat, declared by `prac-client-ui-vscode-explorer`. */
export const VSCODE_SIDEBAR_VIEW = "vscode:sidebar";

/** The part behind each declared view. */
export const PART_OF_VIEW: Readonly<Record<string, string>> = {
  [VSCODE_EDITOR_VIEW]: EDITOR_PART,
  [VSCODE_SIDEBAR_VIEW]: SIDEBAR_PART,
};

/**
 * The workspace the app is started for.
 *
 * It comes from DSH, which owns the workspace registry and binds sessions to
 * workspaces — so the app must be told the *session's* workspace rather
 * than assume one. That is also why it cannot start before a
 * workspace is known: the construction options decide the window's workspace
 * identity (`workspace.id`, which scopes storage, configuration and profile) and
 * that identity is fixed for the life of the page — it cannot be corrected
 * afterwards.
 */
interface WorkspaceLaunch {
  /** Absolute path of the workspace folder. */
  readonly path: string;
}

/**
 * The workspace this window is for, if there is one.
 *
 * Mirrors how `ui-workspace` resolves it: the workspaces registry holds the
 * `sessionIds` of each workspace, so the current workspace is the one containing
 * the current session — falling back to the most recent workspace. Reading it
 * from DSH rather than assuming a path is the whole point: the workspace is a
 * session fact, not a build-time constant.
 *
 * @param ctx - the Cordis client context.
 * @returns the workspace to launch for, or undefined when none is selected.
 */
function activeWorkspace(ctx: Context): WorkspaceLaunch | undefined {
  try {
    const items = ctx.workspaces.list.getSnapshot().items;
    const current = ctx.sessions.list.getSnapshot().current;
    if (current !== undefined) {
      const owning = items.find((item) => item.sessionIds.includes(current));
      if (owning !== undefined) return { path: owning.path };
    }
    // No session yet: the most recent workspace is the one the shell would show
    // (`ui-workspace` calls it `recent` and uses it as the same fallback).
    const recent = [...items].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
    return recent === undefined ? undefined : { path: recent.path };
  } catch {
    return undefined;
  }
}

/**
 * Publish the mechanism's face for the active workspace — once.
 *
 * The IDE side only exists once a workspace does: DSH binds sessions to
 * workspaces, so with no workspace there is nothing to open and no identity to
 * give the app. Booting waits for the registry to produce one, then fires
 * exactly once for the life of the page (the mechanism owns that guard).
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const embed = createVscodeEmbed({ route: VSCODE_ROUTE, productName: "prac" });

  /** Boot the app for the active workspace; true once it is running. */
  const boot = (): boolean => {
    const workspace = activeWorkspace(ctx);
    if (workspace === undefined) return false;
    return embed.boot({ workspacePath: workspace.path });
  };

  // The seat packages are separate bundles and cannot share the mechanism's state
  // (each is inlined independently), so the face they render through is handed
  // over on the **service registry** — the documented channel, which is what
  // makes `inject: ["pracVscode"]` keep a seat pending until this lands. This is
  // the same seam the embed bridge crosses, one level up — seats render parts,
  // the mechanism owns the singleton boot, this row owns the view-to-part policy.
  const face: PracVscodeFace = {
    partHost: (view: string): (() => ReactElement | null) => {
      const part = PART_OF_VIEW[view];
      return part === undefined ? () => null : embed.partHost(part);
    },
  };
  ctx.effect(() => ctx.provide("pracVscode", face), `${name}: pracVscode service`);

  if (!boot()) {
    // No workspace yet: wait for the registry to produce one, then boot once.
    ctx.effect(() => {
      const stop = ctx.workspaces.list.subscribe(() => {
        if (boot()) stop();
      });
      return stop;
    }, `${name}: boot on first workspace`);
  }
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-vscode-host";

/**
 * Boot reads DSH's workspace registry and session list to find the workspace its
 * window is for; it declares no slot, because the seats belong to the seat
 * packages.
 */
export const inject = ["workspaces", "sessions"];
