/** Remove the VS Code build directory (upstream checkout, caches, staged surface). */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageDir, "../..");
const workDir = resolve(process.env.PRAC_VSCODE_DIR ?? join(repoRoot, ".build/vscode"));
rmSync(workDir, { recursive: true, force: true });
console.log(`[prac-vscode] removed ${workDir}`);
