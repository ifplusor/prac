/**
 * Turn-scoped diff text for the changed-files card.
 *
 * The data is already on the Host: `workspaceChanges.summary()` keeps the
 * turn-start / turn-end tree ids, and the recorder wrote those trees into a
 * private object store under the system temp directory. This route reads the
 * complete before / after text from those objects — a thin reader, not a second
 * recorder. It deliberately depends on DSH's private snapshot layout; when that
 * layout changes, fall back to a recorder plugin.
 *
 * @module prac-host-vscode/turn-diff
 */

import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/** Authenticated GET route serving one turn's complete before / after text. */
export const TURN_DIFF_PATH = "/api/prac-turn-diff.text";

/** The prefix `workspace-changes` gives its per-session private object store. */
const SNAPSHOT_PREFIX = "dsh-workspace-changes-";

/** Bytes one side may reach before the route refuses it. */
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** Milliseconds one git command may run. */
const GIT_TIMEOUT_MS = 30_000;

/** One file's turn-start / turn-end text, or a refusal. */
export type TurnDiffText =
  | { kind: "text"; path: string; before: string | null; after: string | null }
  | { kind: "binary" | "oversized" | "missing" };

/** The summary fields this route reads; the rest stays in DSH. */
interface SummaryFile {
  readonly path: string;
  readonly display: string;
  readonly binary?: true;
  readonly oversized?: true;
}

interface Summary {
  readonly turn: number;
  readonly cwd: string;
  readonly files: readonly SummaryFile[];
  readonly snapshot?: { readonly before: string; readonly after: string };
}

interface WorkspaceChangesLike {
  summary(sessionId: string, seq: number): Summary | undefined;
}

interface FetchRoute {
  path: string;
  methods: readonly string[];
  requestBody: "buffered";
  fetch(request: Request): Promise<Response>;
}

interface ConnectionLike {
  fetch: { register(route: FetchRoute): void };
}

interface ProcessHandle {
  done: Promise<{ exitCode: number | null }>;
  collected: {
    stdout?: { readFrom(offset: number): { text: string; lossy: boolean } };
    stderr?: { readFrom(offset: number): { text: string } };
  };
}

interface SubprocessLike {
  resolveExecutable(name: string, env: undefined, signal: AbortSignal): Promise<string>;
  spawn(options: {
    argv: readonly string[];
    cwd: string;
    stdio: {
      stdin: "ignore";
      stdout: { maxBytes: number };
      stderr: { maxBytes: number };
    };
    graceMs: number;
    signal: AbortSignal;
    env: Readonly<Record<string, string>>;
  }): ProcessHandle;
}

/** The injected Host context this route needs. */
export interface TurnDiffContext {
  workspaceChanges: WorkspaceChangesLike;
  connection: ConnectionLike;
  subprocess: SubprocessLike;
  effect(setup: () => void | (() => void | Promise<void>), label?: string): void;
  logger: { warn(message: string): void };
}

/** A settled git command. */
interface GitResult {
  exitCode: number | null;
  stdout: string;
  lossy: boolean;
}

/** Run git with the same scrubbed environment and bounds the recorder uses. */
class Git {
  constructor(
    private readonly process: SubprocessLike,
    private readonly executable: string,
  ) {}

  async run(
    args: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string>>,
    signal: AbortSignal,
    maxBytes = 64 * 1024,
  ): Promise<GitResult> {
    const timeout = AbortSignal.timeout(GIT_TIMEOUT_MS);
    const handle = this.process.spawn({
      argv: [this.executable, ...args],
      cwd,
      stdio: { stdin: "ignore", stdout: { maxBytes }, stderr: { maxBytes: 16 * 1024 } },
      graceMs: 2_000,
      signal: AbortSignal.any([signal, timeout]),
      env: {
        GIT_CONFIG_COUNT: "0",
        GIT_CONFIG_KEY_0: "",
        GIT_CONFIG_VALUE_0: "",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
        ...env,
      },
    });
    const outcome = await handle.done;
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: "", lossy: false };
    return { exitCode: outcome.exitCode, stdout: stdout.text, lossy: stdout.lossy };
  }
}

/**
 * The repository-relative path of one summary file, or undefined when it is
 * outside the repository (the snapshot tree cannot hold it).
 */
export function repoPath(root: string, cwd: string, path: string): string | undefined {
  const rel = relative(root, resolve(cwd, path)).split(sep).join("/");
  return rel === "" || rel === ".." || rel.startsWith("../") ? undefined : rel;
}

/** Parse a route coordinate. */
export function coordinate(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/** The git-prefixed object directory of a repository. */
async function gitObjects(git: Git, cwd: string, signal: AbortSignal): Promise<string | undefined> {
  const found = await git.run(["rev-parse", "--git-path", "objects"], cwd, {}, signal);
  if (found.exitCode !== 0) return undefined;
  return resolve(cwd, found.stdout.trim());
}

/** Find the private (or repository) object store holding a snapshot tree. */
async function findObjectStore(
  git: Git,
  root: string,
  tree: string,
  repositoryObjects: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const candidates = [repositoryObjects];
  try {
    const entries = await readdir(tmpdir(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(SNAPSHOT_PREFIX)) continue;
      candidates.push(join(tmpdir(), entry.name, "objects"));
    }
  } catch {
    // A missing temp directory is just an empty candidate list.
  }
  for (const objects of candidates) {
    const found = await git.run(
      ["cat-file", "-e", tree],
      root,
      { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects },
      signal,
    );
    if (found.exitCode === 0) return objects;
  }
  return undefined;
}

/** Read one tree side; null means the file did not exist on that side. */
async function readSide(
  git: Git,
  root: string,
  objects: string,
  repositoryObjects: string,
  tree: string,
  path: string,
  signal: AbortSignal,
): Promise<string | null> {
  const result = await git.run(
    ["cat-file", "-p", `${tree}:${path}`],
    root,
    { GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects },
    signal,
    MAX_TEXT_BYTES,
  );
  if (result.exitCode !== 0) return null;
  if (result.lossy) throw new Error("snapshot side exceeds the text bound");
  if (result.stdout.includes("\u0000")) throw new Error("snapshot side is binary");
  return result.stdout;
}

/** Resolve one turn's complete before / after text from the DSH snapshots. */
export async function readTurnDiff(
  ctx: TurnDiffContext,
  git: Git,
  summary: Summary,
  index: number,
  signal: AbortSignal,
): Promise<TurnDiffText> {
  const file = summary.files[index];
  if (file === undefined) return { kind: "missing" };
  if (file.binary === true) return { kind: "binary" };
  if (file.oversized === true) return { kind: "oversized" };
  if (summary.snapshot === undefined) return { kind: "missing" };
  const rootResult = await git.run(["rev-parse", "--show-toplevel"], summary.cwd, {}, signal);
  if (rootResult.exitCode !== 0) return { kind: "missing" };
  const root = resolve(summary.cwd, rootResult.stdout.trim());
  const path = repoPath(root, summary.cwd, file.path);
  if (path === undefined) return { kind: "missing" };
  const repositoryObjects = await gitObjects(git, summary.cwd, signal);
  if (repositoryObjects === undefined) return { kind: "missing" };
  const objects = await findObjectStore(
    git,
    root,
    summary.snapshot.after,
    repositoryObjects,
    signal,
  );
  if (objects === undefined) return { kind: "missing" };
  let before: string | null;
  let after: string | null;
  try {
    before = await readSide(
      git,
      root,
      objects,
      repositoryObjects,
      summary.snapshot.before,
      path,
      signal,
    );
    after = await readSide(
      git,
      root,
      objects,
      repositoryObjects,
      summary.snapshot.after,
      path,
      signal,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "snapshot side is binary")
      return { kind: "binary" };
    if (error instanceof Error && error.message === "snapshot side exceeds the text bound")
      return { kind: "oversized" };
    throw error;
  }
  return { kind: "text", path: file.display, before, after };
}

/** Register the authenticated turn-diff text route. */
export function registerTurnDiff(ctx: TurnDiffContext): void {
  let executable: Promise<string | null> | undefined;
  const gitFor = (signal: AbortSignal): Promise<Git | null> => {
    executable ??= ctx.subprocess.resolveExecutable("git", undefined, signal).catch(() => null);
    return executable.then((path) => (path === null ? null : new Git(ctx.subprocess, path)));
  };
  const lifetime = new AbortController();
  const pending = new Set<Promise<Response>>();
  ctx.effect(() => async () => {
    lifetime.abort();
    await Promise.allSettled(pending);
  });

  ctx.connection.fetch.register({
    path: TURN_DIFF_PATH,
    methods: ["GET"],
    requestBody: "buffered",
    fetch: (request) => {
      const task = handle(ctx, request, gitFor, lifetime.signal);
      pending.add(task);
      void task.then(
        () => pending.delete(task),
        () => pending.delete(task),
      );
      return task;
    },
  });
}

async function handle(
  ctx: TurnDiffContext,
  request: Request,
  gitFor: (signal: AbortSignal) => Promise<Git | null>,
  lifetime: AbortSignal,
): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const sessionId = query.get("sessionId");
  const seq = coordinate(query.get("seq"));
  const index = coordinate(query.get("index"));
  if (sessionId === null || sessionId === "" || seq === undefined || index === undefined) {
    return Response.json({ error: "bad coordinates" }, { status: 400 });
  }
  const summary = ctx.workspaceChanges.summary(sessionId, seq);
  if (summary === undefined) return Response.json({ error: "not found" }, { status: 404 });
  const git = await gitFor(AbortSignal.any([request.signal, lifetime]));
  if (git === null) return Response.json({ error: "git unavailable" }, { status: 503 });
  try {
    const result = await readTurnDiff(
      ctx,
      git,
      summary,
      index,
      AbortSignal.any([request.signal, lifetime]),
    );
    if (result.kind === "missing") return Response.json({ error: "not found" }, { status: 404 });
    if (result.kind !== "text") return Response.json({ error: result.kind }, { status: 409 });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    ctx.logger.warn(`prac-turn-diff: ${String(error)}`);
    return Response.json({ error: "snapshot read failed" }, { status: 500 });
  }
}
