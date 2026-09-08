/**
 * Minimal ambient declarations for the DSH platform packages that
 * @prac/web-app imports at runtime.
 *
 * Rationale (a recorded C1 observation, not a conclusion): an out-of-tree DSH
 * consumer cannot cheaply obtain the *transitive* type closure of
 * `@deepseek-ai/dsh-tools` when type-checking/declaring inside its own repo —
 * the generated `lib/types/*.d.ts` files import a broad set of sibling
 * `@deepseek-ai/*` packages, each with their own closure and subpaths. Fully
 * mapping that closure is brittle and machine-coupled.
 *
 * So for C1 we declare just the seams this bundle actually uses, keep the
 * imports external at runtime (they resolve from the DSH installation), and
 * verify correctness at *runtime* against the real platform (see the profile
 * headless check), not by trusting these approximate types. A cleaner
 * consumer story for this friction is a candidate for C2+.
 */

declare module "@deepseek-ai/cordis" {
  /** The Cordis context, scoped to the services this bundle touches. */
  export interface Context {
    /** The scoped tool registry (DSH `ctx.tools`). */
    tools: { register(tool: unknown): void };
  }
}

declare module "@deepseek-ai/dsh-tools" {
  /** Minimal shape of the options accepted by {@link defineTool}. */
  export interface ToolOptions {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    output?: { schema?: unknown; render?: (args: unknown, value: unknown) => unknown };
    execute?: (...args: unknown[]) => unknown;
    [key: string]: unknown;
  }

  /** Declare a model-facing tool on the DSH tool registry. */
  export function defineTool<T extends ToolOptions>(options: T): T;
}
