/**
 * DSH adapter service.
 *
 * @module prac-client-dsh-host/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
import type {} from "prac-client-ui-frame/client";
import {
  DSH_CONVERSATION_VIEW,
  DSH_MAIN_PREFIX,
  DSH_RIGHTBAR_VIEW,
  DSH_SIDEBAR_VIEW,
  dshMainKey,
  dshMainView,
} from "./dsh.js";
import type { PracDshFace } from "./contract.js";

/** Install the DSH adapter service. */
export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.pracApplications.register({
        id: "chat",
        label: "Chat",
        instances: "single",
        defaultRegion: "center",
        content: (windowId, render) => {
          if (render === undefined) return () => null;
          const key = dshMainKey(windowId) ?? "conversation";
          return () => render("main", {}, { entryKey: key });
        },
      }),
    "prac-client-dsh-host: chat app",
  );
  ctx.effect(() => {
    ctx.pracWindows.admit("chat", { windowId: DSH_CONVERSATION_VIEW, title: "Chat" });
    return () => ctx.pracWindows.close(DSH_CONVERSATION_VIEW);
  }, "prac-client-dsh-host: chat window");
  const face: PracDshFace = {
    sidebar: DSH_SIDEBAR_VIEW,
    rightbar: DSH_RIGHTBAR_VIEW,
    conversation: DSH_CONVERSATION_VIEW,
    mainPrefix: DSH_MAIN_PREFIX,
    mainView: dshMainView,
    mainKey: dshMainKey,
  };
  ctx.provide("pracDsh", face);
}

export const name = "prac-client-dsh-host";
export const inject: readonly string[] = ["pracApplications", "pracWindows"];
