/**
 * DSH adapter service.
 *
 * @module prac-client-dsh-host/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
import type { PracAppDef, PracExtension, PracExtensionsFace } from "prac-client-ui-frame/client";
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

const chat: PracAppDef = {
  id: "chat",
  version: "1",
  label: "Chat",
  instances: "single",
  defaultRegion: "center",
};

const sidebar: PracAppDef = {
  id: "dsh.sidebar",
  version: "1",
  label: "Sidebar",
  instances: "single",
  defaultRegion: "left",
};

const rightbar: PracAppDef = {
  id: "dsh.rightbar",
  version: "1",
  label: "Right bar",
  instances: "single",
  defaultRegion: "right",
};

/** Install the DSH adapter service. */
export function apply(ctx: Context): void {
  const extensions: PracExtensionsFace = ctx.pracExtensions;
  const extension: PracExtension = {
    manifest: { id: "prac.dsh-host", origin: "dsh", version: "1" },
    apps: () => [chat, sidebar, rightbar],
    appRuntime: () => ({
      content: (windowId, render, view) => {
        if (render === undefined) return () => null;
        if (windowId === DSH_CONVERSATION_VIEW) {
          const key = dshMainKey(windowId) ?? "conversation";
          return () => render("main", {}, { entryKey: key });
        }
        if (windowId === DSH_SIDEBAR_VIEW) {
          return () =>
            render("sidebar", {
              collapsed: (view?.width ?? 0) === 0,
              width: view?.width ?? 0,
            });
        }
        if (windowId === DSH_RIGHTBAR_VIEW) {
          return () =>
            render("rightbar", {
              width: view?.width ?? 0,
              viewportWidth: view?.viewportWidth ?? 0,
              canShow: (view?.width ?? 0) > 0,
            });
        }
        return () => null;
      },
    }),
  };
  ctx.effect(() => extensions.register(extension), "prac-client-dsh-host: host extension");
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
export const inject: readonly string[] = ["pracExtensions"];
