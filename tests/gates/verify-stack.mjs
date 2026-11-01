/**
 * Verification of the Explorer stack in the rail UI.
 *
 * The old gate assumed a bare left view group and a container bar. The current
 * workbench starts with the Explorer container open, so this gate asserts the
 * stack that is actually on screen: outline / timeline / open editors / file
 * tree, a working header fold, and the frame's stack-toggle contract.
 *
 * Usage: URL='http://127.0.0.1:3084/?token=...' vp run verify:stack
 */
import { openPrac, report, requireUrl } from "./harness.mjs";

const url = requireUrl();
const { page, own, close } = await openPrac(url);

await page.waitForTimeout(2500);

const sample = () =>
  page.evaluate(() => {
    // A container's widgets are laid out inside its board window's isolation root.
    const deepAll = (selector) => {
      const found = [...document.querySelectorAll(selector)];
      const walk = (root) => {
        for (const element of root.querySelectorAll("*")) {
          if (element.shadowRoot) {
            found.push(...element.shadowRoot.querySelectorAll(selector));
            walk(element.shadowRoot);
          }
        }
      };
      walk(document);
      return found;
    };
    const rows = deepAll("[data-prac-stack-entry]").map((entry) => ({
      id: entry.getAttribute("data-prac-stack-entry"),
      collapsed: entry.getAttribute("data-prac-stack-collapsed") === "true",
      height: Math.round(entry.getBoundingClientRect().height),
      header: Math.round(
        entry.querySelector("[data-prac-stack-toggle]")?.getBoundingClientRect().height ?? 0,
      ),
      body: Math.round(
        entry.querySelector("[data-prac-stack-body]")?.getBoundingClientRect().height ?? 0,
      ),
    }));
    const sashes = deepAll("[data-prac-sash]").length;
    return { rows, sashes };
  });

const initial = await sample();
const outline = initial.rows.find((row) => row.id === "vscode:view:outline");
const file = initial.rows.find((row) => row.id === "vscode:view:workbench.explorer.fileView");

await page.click('[data-prac-stack-toggle="vscode:view:workbench.explorer.fileView"]');
await page.waitForTimeout(500);
const folded = await sample();
await page.click('[data-prac-stack-toggle="vscode:view:workbench.explorer.fileView"]');
await page.waitForTimeout(500);
const reopened = await sample();

await close();

const fileOf = (facts) =>
  facts.rows.find((row) => row.id === "vscode:view:workbench.explorer.fileView");

report({
  url,
  facts: { initial, folded, reopened },
  checks: {
    "the Explorer stack has its four rows": [
      "vscode:view:outline",
      "vscode:view:timeline",
      "vscode:view:workbench.explorer.openEditorsView",
      "vscode:view:workbench.explorer.fileView",
    ].every((id) => initial.rows.some((row) => row.id === id)),
    "the file tree has the room": (file?.height ?? 0) > 200,
    "the outline starts folded":
      (outline?.collapsed ?? false) === true && (outline?.body ?? 0) <= 2,
    "the stack has at least one sash": initial.sashes > 0,
    "clicking the file-tree header folds it":
      fileOf(folded)?.collapsed === true && (fileOf(folded)?.body ?? 0) <= 2,
    "folding keeps the header": (fileOf(folded)?.header ?? 0) > 0,
    "clicking again reopens the file tree":
      fileOf(reopened)?.collapsed === false && (fileOf(reopened)?.body ?? 0) > 0,
    "no prac-owned console errors":
      own("__pracFrame").length === 0 && own("prac-client-ui-frame").length === 0,
  },
  ok: "OK: the Explorer stack has its rows, the header folds, and reopening restores the body",
});
