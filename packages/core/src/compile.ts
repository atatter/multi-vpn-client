import { intersect, parseCidr, rangesToCidrs, subtract, type Range } from '@repo/vpn-sdk/cidr';
import { isBroad, rankVpns, RouteDomain, type Config, type RouteRule } from './config.ts';
import type { Vpn } from '@repo/vpns';

/** A range kept direct: a VPN gateway outranks every rule; a local network only broader ones (see `local`). */
export interface ReservedRange {
  cidr: string;
  label: string;
  /**
   * A local network: a narrower rule wins its addresses, as the OS routing table (and so each VPN's own client)
   * decides by longest prefix. Its size comes from the network itself, which mustn't take a VPN's narrower routes.
   */
  local?: boolean;
}

/** What the host must keep direct, and which VPN hosts couldn't be resolved (so aren't protected). */
export interface HostReserved {
  reserved: ReservedRange[];
  unresolved: { vpnId: string; host: string }[];
}

export type Claimant = { kind: 'rule'; ruleId: string } | { kind: 'reserved'; label: string };

export type CompileWarning =
  | { kind: 'shadowed'; ruleId: string; full: boolean; lost: string[]; by: Claimant[] }
  | { kind: 'invalid-cidr'; ruleId: string; message: string }
  | { kind: 'invalid-domain'; ruleId: string; message: string }
  /** A higher domain route already covers this one (subdomains included), or a higher VPN carries everything, so it never applies. */
  | { kind: 'domain-shadowed'; ruleId: string; by: string }
  | { kind: 'unknown-vpn'; ruleId: string; vpnId: string };

/** A domain route that applies: connections to `domain` and its subdomains go through `vpnId`. */
export interface RoutedDomain {
  ruleId: string;
  vpnId: string;
  domain: string;
}

export interface CompiledRoutes {
  /** Minimal, mutually disjoint CIDRs per VPN id. Every VPN gets an entry, possibly empty. */
  byVpn: Record<string, string[]>;
  /** Union of everything routed into a VPN — what the host-side TUN has to capture. */
  all: string[];
  /** Domain routes in priority order (the first matching domain wins). */
  domains: RoutedDomain[];
  warnings: CompileWarning[];
}

export interface CompileInput {
  /** Ordered by priority, highest first: a higher VPN's rules win overlaps. */
  vpns: readonly Pick<Vpn, 'id'>[];
  /** Every VPN's rules. Priority comes from the VPN order; within one VPN, from this order. Pinned rules win whatever the order. */
  routes: readonly RouteRule[];
  reserved?: readonly ReservedRange[];
}

const sizeOf = (range: Range | undefined) => (range ? range[1] - range[0] + 1 : 0);

/** The rule an all-traffic VPN routes. */
export const ALL_TRAFFIC = '0.0.0.0/0';
const allRule = (vpnId: string): RouteRule => ({ id: `all:${vpnId}`, kind: 'cidr', cidr: ALL_TRAFFIC, vpnId, enabled: true, note: '', pinned: false });
const serverRule = (vpnId: string, cidr: string): RouteRule => ({ id: `server:${vpnId}:${cidr}`, kind: 'cidr', cidr, vpnId, enabled: true, note: '', pinned: false });

/** A rule the app derived from the VPN's traffic mode (everything, or what its server sent), not one the user added. */
export const isDerivedRule = (rule: Pick<RouteRule, 'id'>) => rule.id.startsWith('all:') || rule.id.startsWith('server:');

/**
 * What a VPN routes, given its traffic mode: everything; what its server sent plus the user's own routes;
 * or only the user's own routes. A VPN carrying everything keeps its pinned routes, which can still win
 * addresses from a higher VPN. Before the first connect, "official" only knows the user's routes.
 */
export function effectiveRules(vpn: Pick<Vpn, 'id' | 'traffic' | 'serverRoutes'>, routes: readonly RouteRule[]): RouteRule[] {
  const own = routes.filter((route) => route.vpnId === vpn.id);
  if (isBroad(vpn)) return [allRule(vpn.id), ...own.filter((route) => route.pinned)];
  if (vpn.traffic === 'official' && vpn.serverRoutes) return [...vpn.serverRoutes.cidrs.map((cidr) => serverRule(vpn.id, cidr)), ...own];
  return own;
}

/**
 * Turns the user's rules into disjoint routes. Priority follows the order of `vpns` (top wins): a higher
 * VPN's rules come before a lower VPN's, whatever order they're stored in, and pinned rules before all.
 *
 * The OS routes by longest-prefix match, which ignores the user's order, so we
 * resolve priority here: each rule only keeps the addresses no earlier rule
 * (or reserved range, bar a broader local network) has claimed. The output never overlaps, so every engine
 * and the OS routing table agree regardless of how they order routes.
 *
 * Domain routes keep their order instead: the routing engine matches them by
 * name, first match wins. A domain covered by a higher route never applies.
 * Names match before addresses, so a higher VPN's domain route wins even over a lower VPN's pinned
 * IP range that the name resolves into; pin the domain itself to send it elsewhere.
 *
 * Pure and tolerant of bad input (invalid rows become warnings), so the UI can
 * run it live on unsaved edits.
 */
export function compileRoutes({ vpns, routes, reserved = [] }: CompileInput): CompiledRoutes {
  const claims: { by: Claimant; ranges: Range[]; local: boolean }[] = [];
  for (const { cidr, label, local = false } of reserved) {
    const parsed = parseCidr(cidr);
    if (parsed.ok) claims.push({ by: { kind: 'reserved', label }, ranges: [parsed.range], local });
  }

  const owned = new Map<string, Range[]>(vpns.map((vpn) => [vpn.id, []]));
  const domains: RoutedDomain[] = [];
  const warnings: CompileWarning[] = [];

  // Stable sort, so rules keep their stored order within a VPN. Pinned rules go first: they win whatever the order.
  // Unknown VPNs go last (and only warn).
  const rank = new Map(vpns.map((vpn, index) => [vpn.id, index]));
  const order = (route: RouteRule) => (rank.get(route.vpnId) ?? vpns.length) - (route.pinned ? vpns.length + 1 : 0);
  const byPriority = [...routes].sort((a, b) => order(a) - order(b));
  /** The first all-traffic rule seen: lower VPNs' domains would otherwise jump the queue (names match before addresses). */
  let everything: RouteRule | undefined;

  for (const route of byPriority) {
    // Disabled rules route nothing, but are still checked: saving validates every rule.
    if (route.kind === 'domain') {
      const parsed = RouteDomain.safeParse(route.domain);
      if (!parsed.success) {
        warnings.push({ kind: 'invalid-domain', ruleId: route.id, message: parsed.error.issues[0]?.message ?? 'Invalid domain' });
      } else if (!owned.has(route.vpnId)) {
        warnings.push({ kind: 'unknown-vpn', ruleId: route.id, vpnId: route.vpnId });
      } else if (route.enabled) {
        const domain = parsed.data;
        const cover = domains.find((higher) => domain === higher.domain || domain.endsWith(`.${higher.domain}`));
        if (cover) warnings.push({ kind: 'domain-shadowed', ruleId: route.id, by: cover.ruleId });
        else if (everything && everything.vpnId !== route.vpnId && !route.pinned) warnings.push({ kind: 'domain-shadowed', ruleId: route.id, by: everything.id });
        else domains.push({ ruleId: route.id, vpnId: route.vpnId, domain });
      }
      continue;
    }

    const parsed = parseCidr(route.cidr);
    if (!parsed.ok) {
      warnings.push({ kind: 'invalid-cidr', ruleId: route.id, message: parsed.error });
      continue;
    }
    const vpnRanges = owned.get(route.vpnId);
    if (!vpnRanges) {
      warnings.push({ kind: 'unknown-vpn', ruleId: route.id, vpnId: route.vpnId });
      continue;
    }
    if (!route.enabled) continue;

    const requested = [parsed.range];
    const blocking = claims.filter((claim) => !(claim.local && sizeOf(parsed.range) < sizeOf(claim.ranges[0])));
    const shadowedBy = blocking.filter((claim) => intersect(requested, claim.ranges).length > 0);
    const kept = subtract(requested, blocking.flatMap((claim) => claim.ranges));

    if (shadowedBy.length > 0) {
      warnings.push({
        kind: 'shadowed',
        ruleId: route.id,
        full: kept.length === 0,
        lost: rangesToCidrs(subtract(requested, kept)),
        by: shadowedBy.map((claim) => claim.by),
      });
    }

    vpnRanges.push(...kept);
    claims.push({ by: { kind: 'rule', ruleId: route.id }, ranges: kept, local: false });
    if (route.cidr === ALL_TRAFFIC && !route.pinned) everything ??= route;
  }

  const byVpn = Object.fromEntries([...owned].map(([vpnId, ranges]) => [vpnId, rangesToCidrs(ranges)]));
  return { byVpn, all: rangesToCidrs([...owned.values()].flat()), domains, warnings };
}

/** Another VPN taking all or part of a rule's addresses or names. */
export interface Taken {
  /** The VPN that takes it. */
  by: string;
  /** Only part of it is taken. */
  partly: boolean;
  /** Taken by a pinned rule, not by priority. */
  byPin: boolean;
}

/** What happens to one of a VPN's rules while the others are on: it stays, or another VPN takes all or part of it. */
export interface RuleFate {
  rule: RouteRule;
  taken?: Taken;
}

/** One VPN that's on, and what it really carries given the others. */
export interface PlanLayer {
  vpnId: string;
  /** Connected, so it routes. A VPN still connecting, or one that failed, routes nothing yet. */
  live: boolean;
  /** Carries everything (set to, or its server sends everything). */
  broad: boolean;
  /** Each of its rules (enabled ones, including derived ones) and where it really goes. Empty while not live. */
  fates: RuleFate[];
  /** A higher VPN carrying everything leaves this one nothing. */
  starvedBy?: string;
}

/**
 * What each turned-on VPN carries right now, highest priority first: the UI's view of `compileRoutes`.
 * `on`: VPNs the user turned on (connecting, connected or failed); `live`: the connected ones, which route.
 * Reserved ranges are left out: they keep traffic direct, they don't hand it to another VPN.
 */
export function routingPlan(config: Pick<Config, 'vpns' | 'routes' | 'priority'>, on: ReadonlySet<string>, live: ReadonlySet<string>): PlanLayer[] {
  const ranked = rankVpns(config).filter((vpn) => on.has(vpn.id) || live.has(vpn.id));
  const connected = ranked.filter((vpn) => live.has(vpn.id));
  const rules = connected.flatMap((vpn) => effectiveRules(vpn, config.routes).filter((route) => route.enabled));
  const ruleById = new Map(rules.map((route) => [route.id, route]));
  const fates = new Map<string, RuleFate>(rules.map((route) => [route.id, { rule: route }]));
  const takenBy = (ruleId: string, winner: RouteRule | undefined, partly: boolean) => {
    const rule = ruleById.get(ruleId);
    if (rule && winner && winner.vpnId !== rule.vpnId) fates.set(ruleId, { rule, taken: { by: winner.vpnId, partly, byPin: winner.pinned } });
  };

  for (const warning of compileRoutes({ vpns: connected, routes: rules }).warnings) {
    if (warning.kind === 'shadowed') {
      const own = ruleById.get(warning.ruleId)?.vpnId;
      // Overlaps within one VPN aren't conflicts: the traffic still goes where the rule says. When several
      // higher VPNs share it, one carrying everything is the one that matters: it leaves nothing behind.
      const others = warning.by.flatMap((claimant) => (claimant.kind === 'rule' ? (ruleById.get(claimant.ruleId) ?? []) : [])).filter((route) => route.vpnId !== own);
      const winner = others.find((route) => route.kind === 'cidr' && route.cidr === ALL_TRAFFIC) ?? others[0];
      takenBy(warning.ruleId, winner, !warning.full);
    } else if (warning.kind === 'domain-shadowed') {
      takenBy(warning.ruleId, ruleById.get(warning.by), false);
    }
  }

  // A higher VPN routing a subdomain takes part of a lower VPN's domain (the compiler keeps both).
  const rank = new Map(connected.map((vpn, index) => [vpn.id, index]));
  const domains = rules.flatMap((route) => {
    const parsed = route.kind === 'domain' ? RouteDomain.safeParse(route.domain) : undefined;
    return parsed?.success ? [{ route, domain: parsed.data }] : [];
  });
  for (const lower of domains) {
    if (fates.get(lower.route.id)?.taken) continue;
    // Only subdomains that really route: one a pin (or a higher VPN) already took doesn't take anything itself.
    const higher = domains.find(
      (other) =>
        other.domain.endsWith(`.${lower.domain}`) &&
        !fates.get(other.route.id)?.taken &&
        (other.route.pinned || (rank.get(other.route.vpnId) ?? 0) < (rank.get(lower.route.vpnId) ?? 0)),
    );
    if (higher) takenBy(lower.route.id, higher.route, true);
  }

  const broadIds = new Set(connected.filter(isBroad).map((vpn) => vpn.id));
  return ranked.map((vpn) => {
    const mine = rules.filter((route) => route.vpnId === vpn.id).map((route) => fates.get(route.id) ?? { rule: route });
    // Unused when a higher VPN carrying everything takes all it has, or it has nothing of its own under one.
    const broadAbove = connected.slice(0, connected.findIndex((other) => other.id === vpn.id)).find(isBroad)?.id;
    const nothingLeft = mine.every((fate) => fate.taken && !fate.taken.partly);
    const takenByBroad = mine.flatMap((fate) => (fate.taken && broadIds.has(fate.taken.by) ? [fate.taken.by] : []))[0];
    const starvedBy = !live.has(vpn.id) || !nothingLeft ? undefined : (takenByBroad ?? (mine.length === 0 ? broadAbove : undefined));
    return { vpnId: vpn.id, live: live.has(vpn.id), broad: isBroad(vpn), fates: mine, ...(starvedBy ? { starvedBy } : {}) };
  });
}

const contains = (cidr: string, address: string) => {
  const range = parseCidr(cidr);
  const target = parseCidr(address);
  return range.ok && target.ok && range.range[0] <= target.range[0] && target.range[1] <= range.range[1];
};

/**
 * Which VPN carries traffic to a host, given the compiled routes, or undefined for the normal connection.
 * Names match first (as the router does), then the host's addresses.
 */
export function routeFor(compiled: Pick<CompiledRoutes, 'byVpn' | 'domains'>, target: { domain?: string; addresses: readonly string[] }): string | undefined {
  const { domain } = target;
  if (domain) {
    const named = compiled.domains.find((route) => domain === route.domain || domain.endsWith(`.${route.domain}`));
    if (named) return named.vpnId;
  }
  for (const address of target.addresses) {
    const owner = Object.entries(compiled.byVpn).find(([, cidrs]) => cidrs.some((cidr) => contains(cidr, address)));
    if (owner) return owner[0];
  }
  return undefined;
}
