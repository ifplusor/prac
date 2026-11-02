/**
 * DSH adapter service.
 *
 * @module prac-client-ui-dsh/client/service
 */

import type { Context } from "@deepseek-ai/cordis";
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

export const name = "prac-client-ui-dsh";
export const inject: readonly string[] = [];
