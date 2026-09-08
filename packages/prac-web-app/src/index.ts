/**
 * @prac/web-app — the prac web-surface bundle.
 *
 * This is a DSH *consumer* bundle: it mounts in a profile beside the real
 * platform bundles and registers the prac-owned model-facing capabilities.
 * For C1 it registers a single identity/health tool, `prac_ping`, so we can
 * verify that an independent out-of-tree consumer can actually extend DSH
 * through the documented tool-registration extension point.
 *
 * Runtime note: DSH platform packages (`@deepseek-ai/dsh-tools`,
 * `@deepseek-ai/cordis`) are intentionally **not** bundled here. They resolve
 * at runtime from the DSH installation through the profile's module fallback.
 * The build marks them external; see `vite.config.ts` and the `build` script.
 *
 * @module prac-web-app
 */

import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** The cordis plugin name used by loader diagnostics. */
export const name = "prac-web-app";

/** The DSH services this plugin needs: the scoped tool registry. */
export const inject = ["tools"];

/** The result shape of {@link prac_ping}. */
export interface PingResult {
  ok: boolean;
  name: string;
  version: string;
  time: number;
}

function ping(): PingResult {
  return { ok: true, name: "prac", version: "0.0.0", time: Date.now() };
}

/** Register the prac-owned tools on the DSH tool registry. */
export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: "prac_ping",
      description: "Prac identity/health check. Returns the prac name, version and current time.",
      parameters: {},
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            name: { type: "string", required: true },
            version: { type: "string", required: true },
            time: { type: "integer", required: true },
          },
        },
        render: (_args: unknown, value: unknown) => {
          const r = value as PingResult;
          return [
            {
              type: "text",
              text: `prac_ping: ok=${r.ok}, name=${r.name}, version=${r.version}, time=${r.time}`,
            },
          ];
        },
      },
      async execute(): Promise<PingResult> {
        return ping();
      },
    }),
  );
}
