/**
 * The chat app: the agent conversation as a window.
 *
 * DSH is a host extension — it owns the conversation's body. This package owns
 * the app: its identity, its launch, and the window it creates.
 *
 * @module prac-client-ui-chat
 */

import type { Context } from "@deepseek-ai/cordis";
import type { PracAppDef, PracExtension, PracExtensionsFace } from "prac-client-ui-frame/client";

/** The app's stable id. */
export const CHAT_APP_ID = "chat";

/** The conversation's one window. */
export const CHAT_WINDOW_ID = "dsh:main:conversation";

const chat: PracAppDef = {
  id: CHAT_APP_ID,
  version: "1",
  label: "Chat",
  instances: "single",
  defaultRegion: "center",
};

/**
 * Install the chat app.
 *
 * @param ctx - the Cordis client context.
 */
export function apply(ctx: Context): void {
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  const extension: PracExtension = {
    manifest: { id: "prac.chat", version: "1" },
    apps: () => [chat],
    appRuntime: () => ({
      content: () => () => null,
      start: (params: unknown, instance: { id: string }) => {
        const { windowId, region } = params as { windowId?: string; region?: string };
        try {
          ctx.pracWindows.admit(CHAT_APP_ID, {
            windowId: windowId ?? CHAT_WINDOW_ID,
            region,
            content: () => null,
            instanceId: instance.id,
          });
        } catch {
          // The region may not exist yet; the next launch retries.
          return false;
        }
        return true;
      },
    }),
  };
  ctx.effect(() => extensions.register(extension), "prac-client-ui-chat: the chat app");
}

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-client-ui-chat";

/** The DSH services this plugin needs. */
export const inject = ["pracExtensions", "pracWindows"];
