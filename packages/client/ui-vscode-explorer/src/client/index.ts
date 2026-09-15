/**
 * prac-client-ui-vscode-explorer — the explorer seat.
 *
 * Declares exactly one `prac.view` entry, `vscode:sidebar`, whose component is the
 * part-host element built by the shared mechanism (`prac-client-vscode-host`). The
 * VS Code part behind it is the sidebar part, which is where the explorer (and the
 * views beside it) live.
 *
 * The mechanism arrives as an injected **service** (`ctx.pracVscode`) rather than
 * as an import, because each client plugin is bundled and inlined on its own: an
 * imported module would duplicate the singleton boot guard. Injecting it is what
 * lets the two seats be separate bundles, each placeable, showable, or disabled
 * on its own.
 *
 * @module prac-client-ui-vscode-explorer/client
 */

import type { Context } from "@deepseek-ai/cordis";
import type { SlotRegistry } from "@deepseek-ai/dsh-client-ui-renderer/client";
import type { PracVscodeFace } from "prac-client-vscode-host/client";
import type { ViewSeatKey } from "prac-client-ui-layout/client";

/** The view id this package declares. */
const VSCODE_SIDEBAR_VIEW = "vscode:sidebar";

/** The seat it declares that view into (checked against the mechanism's key type). */
const SEAT: ViewSeatKey = "prac.view";

/**
 * Declare the explorer seat on the frame's `prac.view` seat.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  // The mechanism comes from the service registry; naming its published face here
  // is what keeps this seat's use of it checked.
  const host: PracVscodeFace = ctx.pracVscode;
  const slots: SlotRegistry = ctx.slots;
  // The seat is declared by prac-client-ui-layout's frame; injecting waits for that
  // declaration, since either client plugin may activate first.
  ctx.effect(
    () =>
      slots.inject(SEAT, () =>
        slots.register(
          { name: SEAT, id: VSCODE_SIDEBAR_VIEW },
          // The mechanism is injected, so it is present before this runs; the
          // component it returns renders an empty host until the VS Code side
          // of the bridge has published its face, then fills it.
          () => host.partHost(VSCODE_SIDEBAR_VIEW)() ?? null,
        ),
      ),
    `prac-client-ui-vscode-explorer: ${VSCODE_SIDEBAR_VIEW} view`,
  );
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-vscode-explorer";

/** The DSH services this plugin needs: the seat, and the mechanism that renders it. */
export const inject = ["slots", "pracVscode"];
