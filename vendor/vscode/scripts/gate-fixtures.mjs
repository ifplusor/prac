/**
 * Fixture files for the vendor gates.
 *
 * A gate must not depend on whichever folder the app happens to have open: the app's
 * workspace is DSH's **last-used** one (`~/.dsh/storages/workspace.json`), so it
 * changes with what the person is working on. Measured: every folder-dependent gate
 * went red the moment the last-used workspace stopped being this repository
 * (`~/Downloads/简历` — the gate opened a `package.json` that is not there). A gate
 * therefore writes its own files under the build's scratch directory and opens them
 * **by URI**: the workbench's file service serves any path under its remote
 * authority, so no workspace is needed for a fixture.
 *
 * @module gate-fixtures
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** This checkout's root (`vendor/vscode/scripts` → up three). */
const repoRoot = resolve(import.meta.dirname, "../../..");

/**
 * Write a gate's fixtures, replacing whatever an earlier run left.
 *
 * @param label - a directory name for this gate, so gates never share a directory.
 * @param url - the page URL; its authority is what the file URIs need.
 * @param files - `{ name, body }` entries. `body` may be a function of the run's token.
 * @returns one entry per file: its name, absolute path, URI, token and marker line.
 */
export function writeFixtures(label, url, files) {
  const token = randomUUID().slice(0, 8);
  const dir = join(repoRoot, ".build/scratch/gate-fixtures", label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const authority = new URL(url).host;
  return files.map((file) => {
    const body = typeof file.body === "function" ? file.body(token) : file.body;
    const path = join(dir, file.name);
    writeFileSync(path, body, "utf8");
    // The marker is a line of the file *as written*, so an assertion that the editor
    // shows this file's text is a claim about the file rather than about a string the
    // gate also happened to keep in a variable.
    const marker =
      body
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.includes(token)) ?? token;
    return {
      name: file.name,
      body,
      marker,
      path,
      token,
      uri: `vscode-remote://${authority}${path}`,
    };
  });
}
