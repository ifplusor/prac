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
  // The right rail is a host panel: an app window whose body renders the host's
  // `rightbar` slot with the box the frame hands to the app content.
  ctx.effect(
    () =>
      ctx.pracApplications.register({
        id: "dsh.rightbar",
        label: "Right bar",
        instances: "single",
        defaultRegion: "right",
        content: (_windowId, render, view) => {
          if (render === undefined) return () => null;
          return () =>
            render("rightbar", {
              width: view?.width ?? 0,
              viewportWidth: view?.viewportWidth ?? 0,
              canShow: (view?.width ?? 0) > 0,
            });
        },
      }),
    "prac-client-dsh-host: rightbar app",
  );
  ctx.effect(() => {
    ctx.pracWindows.admit("chat", { windowId: DSH_CONVERSATION_VIEW, title: "Chat" });
    ctx.pracWindows.admit("dsh.rightbar", { windowId: DSH_RIGHTBAR_VIEW, title: "Right bar" });
    return () => {
      ctx.pracWindows.close(DSH_CONVERSATION_VIEW);
      ctx.pracWindows.close(DSH_RIGHTBAR_VIEW);
    };
  }, "prac-client-dsh-host: host windows");
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
