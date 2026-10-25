import {
  compileRoutes,
  type CompiledRoutes,
  effectiveRules,
  isBroad,
  rankVpns,
  ROUTING_RESERVED_RANGE,
  type Config,
  type ServerRoutes,
  type Vpn,
  type VpnTunnel,
} from '@repo/core';
import { hostReserved } from '@repo/core/host';
import type { VpnSession } from '../container/start.ts';

/** What the host should route for the connected VPNs (`sessions`, by VPN id) right now; undefined when nothing is connected. */
export async function planRoutes(config: Config, sessions: ReadonlyMap<string, VpnSession>) {
  // Highest priority first: when two connected VPNs cover an address, the higher one gets it.
  const connected = rankVpns(config).flatMap((vpn) => {
    const session = sessions.get(vpn.id);
    return session ? [{ vpn, session }] : [];
  });
  if (connected.length === 0) {
    return undefined;
  }

  const host = await hostReserved(config.vpns);
  // The placeholder addresses for domain routes must never be claimed by an IP route, and neither may the
  // servers the clients actually connected to (e.g. the gateway a portal picked): a tunnel inside itself loops.
  const endpoints = connected.flatMap(({ vpn, session }) =>
    session.endpoint ? [{ cidr: `${session.endpoint}/32`, label: `${vpn.name}'s server` }] : [],
  );
  const reserved = [
    ...host.reserved,
    ...endpoints,
    { cidr: ROUTING_RESERVED_RANGE, label: 'Domain routing' },
  ];
  // Only connected VPNs claim addresses: a higher VPN that's off mustn't take them from a lower one that's on.
  // Each routes what its traffic mode says: its own routes, what its server sent, or everything.
  const routes = connected.flatMap(({ vpn }) => effectiveRules(vpn, config.routes));
  const compiled = compileRoutes({ vpns: connected.map(({ vpn }) => vpn), routes, reserved });
  const tunnels: VpnTunnel[] = connected.map(({ vpn, session }) => ({
    vpnId: vpn.id,
    port: session.port,
    username: session.username,
    password: session.password,
    cidrs: compiled.byVpn[vpn.id] ?? [],
    dns: {
      servers: vpn.dns.servers.length > 0 ? vpn.dns.servers : session.pushedDns,
      domains: vpn.dns.domains,
    },
  }));
  const domains = compiled.domains.map(({ vpnId, domain }) => ({ vpnId, domain }));
  // A VPN carrying everything can't carry IPv6, so the host refuses IPv6 rather than send it around the VPN.
  const blockIpv6 = connected.some(({ vpn }) => isBroad(vpn));

  return { tunnels, domains, blockIpv6, compiled };
}

export type RoutePlan = NonNullable<Awaited<ReturnType<typeof planRoutes>>>;

/**
 * Warns when a connected VPN carries nothing: it has nothing of its own (no sites, nothing learned from its
 * server), or all it has is kept for the host (its own network, a VPN's server). Routes another VPN takes
 * don't count: the UI explains those, and they change with the other VPNs.
 */
export function noRoutesWarning(
  vpn: Vpn | undefined,
  routes: Config['routes'],
  compiled: CompiledRoutes | undefined,
) {
  if (!vpn || !compiled) {
    return undefined;
  }

  const nothingSent =
    'Connected, but nothing is sent through it yet. Choose what goes through it in its settings.';
  const own = new Set(
    effectiveRules(vpn, routes).flatMap((rule) => (rule.enabled ? [rule.id] : [])),
  );
  if (own.size === 0) {
    return nothingSent;
  }

  const carries =
    (compiled.byVpn[vpn.id]?.length ?? 0) > 0 ||
    compiled.domains.some((domain) => domain.vpnId === vpn.id);
  if (carries) {
    return undefined;
  }

  const takenByAnother = compiled.warnings.some(
    (warning) =>
      own.has(warning.ruleId) &&
      (warning.kind === 'domain-shadowed' ||
        (warning.kind === 'shadowed' && warning.by.some((claimant) => claimant.kind === 'rule'))),
  );

  return takenByAnother ? undefined : nothingSent;
}

/** Whether what a server sent matches what was saved for it before. */
export const sameRoutes = (a: ServerRoutes | null, b: ServerRoutes) =>
  a !== null && a.all === b.all && a.cidrs.join() === b.cidrs.join();
