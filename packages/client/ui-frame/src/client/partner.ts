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
  /** The plugins joined to each base partner (one partner may span plugins). */
  const joined = new Map<string, Set<PracPartner>>();
  return {
    register(partner: PracPartner): () => void {
      const providers = joined.get(partner.name) ?? new Set<PracPartner>();
      providers.add(partner);
      joined.set(partner.name, providers);
      const leave = (): void => {
        providers.delete(partner);
        if (providers.size === 0) joined.delete(partner.name);
      };
      const dispose = ctx.slots.inject(WIDGET_SLOT, () => {
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
        // Apps the partner contributes: register each definition once and keep the
        // windows it asks for open in step (open on appearance, close on removal).
        const apps = new Map<string, { dispose: () => void; windows: Set<string> }>();
        const syncApps = (): void => {
          const wanted = new Map(
            (partner.applications?.() ?? []).map((app) => [app.id, app] as const),
          );
          for (const [id, record] of Array.from(apps)) {
            // An app lives as long as the partner still lists it; its having no
            // open window right now is normal (a file app between files), not a
            // reason to unregister it.
            if (wanted.has(id)) continue;
            for (const windowId of record.windows) ctx.pracWindows.close(windowId);
            record.dispose();
            apps.delete(id);
          }
          for (const app of wanted.values()) {
            let record = apps.get(app.id);
            if (record === undefined) {
              record = {
                dispose: ctx.pracApplications.register({
                  id: app.id,
                  label: app.label,
                  instances: app.instances,
                  ...(app.defaultRegion === undefined ? {} : { defaultRegion: app.defaultRegion }),
                  ...(app.paneHeader === true ? { paneHeader: true } : {}),
                  content: (windowId) => app.content(windowId),
                }),
                windows: new Set(),
              };
              apps.set(app.id, record);
            }
            const open = new Set(app.windows().map((window) => window.id));
            for (const windowId of record.windows) {
              if (open.has(windowId)) continue;
              ctx.pracWindows.close(windowId);
              record.windows.delete(windowId);
            }
            for (const window of app.windows()) {
              if (record.windows.has(window.id)) continue;
              ctx.pracWindows.admit(app.id, { windowId: window.id, title: window.title });
              record.windows.add(window.id);
            }
          }
        };
        sync();
        syncApps();
        const stop = partner.onDidChange(() => {
          sync();
          syncApps();
        });
        return () => {
          stop();
          for (const { dispose } of registered.values()) dispose();
          registered.clear();
          for (const record of apps.values()) {
            for (const windowId of record.windows) ctx.pracWindows.close(windowId);
            record.dispose();
          }
          apps.clear();
        };
      });
      return () => {
        leave();
        dispose();
      };
    },
    partners: () =>
      [...joined.entries()].map(([name, providers]) => ({
        name: name as PracPartner["name"],
        providers: providers.size,
      })),
  };
}
