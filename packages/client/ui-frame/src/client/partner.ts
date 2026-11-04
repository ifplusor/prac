/**
 * The partner runner: project a base partner's contributions into registrations.
 *
 * A partner (VS Code, DSH) owns content and says what it offers; prac owns the
 * composition. The runner is the only place that turns those contributions into
 * `prac.widget` registrations (and, later, application windows). It does **not**
 * own placement, regions, geometry or active state: it only keeps the
 * registrations aligned with the partner's list.
 *
 * @module prac-client-ui-frame/client/partner
 */

import type { Context } from "@deepseek-ai/cordis";

import type { PracContribution, PracPartner, PracPartnersFace } from "./contract.js";

/** The content slot a `widget` contribution registers into. */
const WIDGET_SLOT = "prac.widget" as const;

/** The shape that decides whether a registration has to be replaced. */
const shapeOf = (contribution: PracContribution): string =>
  JSON.stringify({
    kind: contribution.kind,
    label: contribution.label ?? "",
    icon: contribution.icon ?? "",
    paneHeader: contribution.paneHeader === true,
  });

/**
 * Create the registry the frame publishes as `ctx.pracPartners`.
 *
 * @param ctx - the Cordis client context.
 * @returns the registry; `register` returns a disposer for one partner.
 */
export function createPartnerRegistry(ctx: Context): PracPartnersFace {
  return {
    register(partner: PracPartner): () => void {
      return ctx.slots.inject(WIDGET_SLOT, () => {
        const registered = new Map<string, { shape: string; dispose: () => void }>();
        const sync = (): void => {
          const contributions = partner
            .contributions()
            .filter((contribution) => contribution.kind === "widget");
          const byId = new Map(
            contributions.map((contribution) => [contribution.id, contribution]),
          );
          for (const [id, record] of Array.from(registered)) {
            const contribution = byId.get(id);
            if (contribution !== undefined && shapeOf(contribution) === record.shape) continue;
            record.dispose();
            registered.delete(id);
          }
          for (const contribution of contributions) {
            if (registered.has(contribution.id)) continue;
            const host = partner.hostFor(contribution.id);
            const content = partner.wrap?.(contribution, host) ?? host;
            // `icon` / `paneHeader` are this mechanism's extra slot options; the
            // registry's base options type does not know them, so keep them out of
            // the literal's excess-property check (the adapter did the same).
            const options = {
              name: WIDGET_SLOT,
              id: contribution.id,
              ...(contribution.label === undefined ? {} : { label: contribution.label }),
              ...(contribution.icon === undefined ? {} : { icon: contribution.icon }),
              ...(contribution.paneHeader === true ? { paneHeader: true } : {}),
            } as const;
            registered.set(contribution.id, {
              shape: shapeOf(contribution),
              dispose: ctx.slots.register(options, content),
            });
          }
        };
        sync();
        const stop = partner.onDidChange(sync);
        return () => {
          stop();
          for (const { dispose } of registered.values()) dispose();
          registered.clear();
        };
      });
    },
  };
}
