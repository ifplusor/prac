/**
 * Split failed live checks into behaviour and probes.
 *
 * A **behaviour** check asserts something a person can see (a surface renders, a
 * tab switches, state survives a reload). A **probe** check reads an internal
 * (the frame's item list, the slot registry, the embed face); it is allowed, but
 * coupled to the current model — a probe failure after an intended model change
 * means **update the gate**, not that the change was wrong.
 *
 * Kept dependency-free on purpose: the vendor gates import Playwright from their
 * own copy, and importing the harness here would load a second one.
 *
 * @param {Record<string, boolean>} checks - the gate's checks.
 * @param {readonly string[]} [probes] - names of the checks that read internals.
 * @returns {{ failed: string[], probes: string[], behaviour: string[] }} the split.
 */
export function classifyFailures(checks, probes = []) {
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  const probeSet = new Set(probes);
  return {
    failed,
    probes: failed.filter((name) => probeSet.has(name)),
    behaviour: failed.filter((name) => !probeSet.has(name)),
  };
}
