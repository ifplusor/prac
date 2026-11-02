/**
 * Changed-files turn-tail card plugin.
 *
 * @module prac-client-ui-changed-files/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
// Type-only, for the `Context.slots` augmentation: this plugin registers into
// DSH's slot registry, so it names the renderer that owns that service.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "prac-client-vscode-host/client";
import { PracChangedFiles, type ChangedFilesInjected } from "./changed-files.js";
import { CHANGED_FILES_CSS } from "./style.js";

const SLOT = "conversation.chat.turnTail";

/** Install the card. */
export function apply(ctx: Context): void {
  const style = document.createElement("style");
  style.dataset.prac = "changed-files";
  style.textContent = CHANGED_FILES_CSS;
  document.head.append(style);
  ctx.effect(() => () => style.remove(), "prac-changed-files: styles");

  const slots = ctx.slots;
  const inject = slots.inject.bind(slots) as unknown as (
    name: string,
    callback: () => unknown,
  ) => void;
  const register = slots.register.bind(slots) as unknown as (
    options: {
      name: string;
      id: string;
      order?: number;
      inject: () => ChangedFilesInjected;
    },
    component: unknown,
  ) => unknown;
  inject(SLOT, () =>
    register(
      {
        name: SLOT,
        id: "prac-changed-files",
        order: 20,
        inject: (): ChangedFilesInjected => ({
          openTurnDiff: (args) => ctx.pracVscode.runCommand("prac.openTurnDiff", args),
        }),
      },
      PracChangedFiles,
    ),
  );
}

export const name = "prac-client-ui-changed-files";
export const inject = ["slots", "pracVscode"];
