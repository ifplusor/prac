/** Remove the workbench build directory (upstream checkout, caches, staged surface). */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_WORKBENCH_DIR ?? join(repoRoot, ".build/workbench"));
rmSync(workDir, { recursive: true, force: true });
console.log(`[prac-vscode] removed ${workDir}`);
