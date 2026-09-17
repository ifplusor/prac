/**
 * Clean the VS Code build.
 *
 * Default: put the checkout back on the pinned tag (`git checkout --force` + `git clean
 * -fd`, neither of which touches ignored paths, so `node_modules` stays) and delete the
 * build output (`out-*`). The clone, the dependencies and the caches survive, so the next
 * build only rebuilds.
 *
 * `--all`: remove the checkout entire — the next build clones and installs from scratch.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
const all = process.argv.includes("--all");
/** @param {string} message */
function log(message) {
  console.log(`[prac-vscode] ${message}`);
}

/** @param {string[]} args */
function git(...args) {
  log(`run: git ${args.join(" ")}`);
  const result = spawnSync("git", args, { cwd: workDir, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} exited with ${result.status}`);
}

if (!existsSync(workDir)) {
  log(`nothing to clean at ${workDir}`);
} else if (all) {
  rmSync(workDir, { recursive: true, force: true });
  log(`removed ${workDir}`);
} else {
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const tag = pkg.prac?.vscode?.tag;
  if (!tag) throw new Error("package.json is missing prac.vscode.tag");
  if (existsSync(join(workDir, ".git"))) {
    git("checkout", "--force", tag);
    git("clean", "-fd");
    log(`reset to ${tag}`);
  } else {
    log(`not a git checkout, reset skipped: ${workDir}`);
  }
  for (const name of readdirSync(workDir).filter((entry) => entry.startsWith("out-"))) {
    rmSync(join(workDir, name), { recursive: true, force: true });
    log(`removed ${name}`);
  }
  log("kept the clone, node_modules and caches (--all removes everything)");
}
