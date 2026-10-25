import {
  isBroad,
  isDerivedRule,
  routingPlan,
  settleVpn,
  PASSWORD_SLOT,
  type Config,
  type RouteRule,
  type Vpn,
} from '@repo/core';
import { vpnLabel } from '../domain/labels.ts';
import type { PendingSecrets } from '../domain/secrets.ts';

/**
 * What the VPN page decides, without React: what the user changed, whether saving reconnects, and the config
 * that saving or removing produces. The page holds only the user's own edits, on top of the saved VPN.
 */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields of `next` that differ from `saved`: only what the user changed, so changes the app saves itself flow in. */
export function changedFields(saved: Vpn, next: Vpn): Partial<Vpn> {
  const keys = Object.keys(next) as (keyof Vpn)[];
  return Object.fromEntries(
    keys.filter((key) => !same(next[key], saved[key])).map((key) => [key, next[key]]),
  ) as Partial<Vpn>;
}

/** Edited sites count only while they differ from the saved ones, so undoing an edit makes the page clean again. */
export const routeEditsOf = (next: RouteRule[], saved: readonly RouteRule[]) =>
  same(next, saved) ? undefined : next;

/** Whether there's anything to save: changed fields, edited sites or typed secrets. */
export const isDirty = (
  saved: Vpn,
  draft: Vpn,
  routeEdits: RouteRule[] | undefined,
  pending: PendingSecrets,
) =>
  Object.keys(changedFields(saved, draft)).length > 0 ||
  routeEdits !== undefined ||
  Object.keys(pending).length > 0;

/**
 * What changes how it connects, so saving it reconnects a connected VPN. Name, traffic and sites apply
 * without one; so does whether the password is remembered (it's only read when connecting).
 */
const connectionPart = ({
  name: _name,
  traffic: _traffic,
  rememberPassword: _remember,
  ...rest
}: Vpn) => JSON.stringify(rest);

/** Whether saving reconnects it: only a connected VPN whose connection settings or secrets change. A new password only matters on the next connect. */
export const savingReconnects = (
  saved: Vpn,
  draft: Vpn,
  pending: PendingSecrets,
  connected: boolean,
) =>
  connected &&
  (connectionPart(draft) !== connectionPart(saved) ||
    Object.keys(pending).some((key) => key !== PASSWORD_SLOT.key));

/** The config after saving the edited VPN and its sites. Switching between "all traffic" and its own network moves it to where that kind starts. */
export function configAfterSave(
  config: Config,
  saved: Vpn,
  draft: Vpn,
  routes: readonly RouteRule[],
): Config {
  const vpns = config.vpns.map((other) => (other.id === draft.id ? draft : other));
  const next = {
    ...config,
    vpns,
    routes: [...config.routes.filter((route) => route.vpnId !== draft.id), ...routes],
  };
  return {
    ...next,
    priority: isBroad(draft) === isBroad(saved) ? config.priority : settleVpn(next, draft.id),
  };
}

/** The config without the VPN and its sites. */
export const configAfterRemove = (config: Config, vpnId: string): Config => ({
  ...config,
  vpns: config.vpns.filter((other) => other.id !== vpnId),
  routes: config.routes.filter((route) => route.vpnId !== vpnId),
});

/**
 * Which of the edited VPN's own sites a higher VPN wins while both are on, by rule id, with the winner's name.
 * All-traffic VPNs aside (they win everything below them), and pins aside (they win whatever the order).
 */
export function siteWarnings(
  config: Config,
  draft: Vpn,
  routes: readonly RouteRule[],
): ReadonlyMap<string, { winner: string }> {
  const hypothetical = configAfterSave(config, draft, draft, routes);
  const everyone = new Set(config.vpns.map((other) => other.id));
  const broadIds = new Set(hypothetical.vpns.filter(isBroad).map((other) => other.id));
  const own = routingPlan(hypothetical, everyone, everyone).find(
    (layer) => layer.vpnId === draft.id,
  );
  const nameOf = (vpnId: string) =>
    vpnLabel(config.vpns.find((other) => other.id === vpnId) ?? { name: '' });
  return new Map(
    (own?.fates ?? []).flatMap((fate) =>
      fate.taken && !fate.taken.byPin && !broadIds.has(fate.taken.by) && !isDerivedRule(fate.rule)
        ? [[fate.rule.id, { winner: nameOf(fate.taken.by) }] as const]
        : [],
    ),
  );
}
