import { z } from "zod";
import { isIpv4 } from "@repo/vpn-sdk/cidr";
import { Cidr, Domain } from "@repo/vpn-sdk";
import { Vpn, vpnHosts } from "@repo/vpns";

/**
 * The persisted user configuration (no secrets — those live in the secret store): the VPNs (@repo/vpns, one
 * integration each), the routes and the priority. `routes` is ordered by priority: the first rule that covers
 * an address wins it (see `compileRoutes`). Optional text fields use "" for "not set".
 */

// --- What a VPN's server sent ----------------------------------------------

/**
 * What a server sent is the app's to write, not the window's: a save keeps the stored value, unless the VPN
 * now connects somewhere else (another kind or address), where it no longer applies. The window uses it the
 * other way round, to take newly learned values into the config it shows.
 */
export function keepServerRoutes(previous: readonly Vpn[], next: readonly Vpn[]): Vpn[] {
  return next.map((vpn) => {
    const before = previous.find((candidate) => candidate.id === vpn.id);
    const sameServer = before !== undefined && before.kind === vpn.kind && vpnHosts(before).join() === vpnHosts(vpn).join();
    return { ...vpn, serverRoutes: sameServer ? before.serverRoutes : null };
  });
}

/** Carries all traffic: set to, or its server sends everything (known after the first connect). */
export const isBroad = (vpn: Pick<Vpn, "traffic" | "serverRoutes">) => vpn.traffic === "all" || (vpn.traffic === "official" && vpn.serverRoutes?.all === true);

// --- Routes & config -------------------------------------------------------

/**
 * Cleans what someone typed or pasted as a domain:
 * "https://Argo.Lab.example:8443/x" → "argo.lab.example", "*.lab.example" → "lab.example".
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // scheme
    .replace(/[/?#].*$/, "") // path, query, fragment
    .replace(/:\d+$/, "") // port
    .replace(/^(\*\.|\.)/, "") // wildcard or leading dot: subdomains are always included
    .replace(/\.$/, "");
}

/**
 * What someone pasted, as a site: "https://Jira.example.com/browse/1" → { site: "jira.example.com", isAddress: false },
 * "10.140.3.17" → { site: "10.140.3.17", isAddress: true }; undefined when it's neither a host nor an IPv4 address.
 */
export function parseSite(text: string): { site: string; isAddress: boolean } | undefined {
  const site = normalizeDomain(text);
  if (isIpv4(site)) return { site, isAddress: true };
  return site.includes(".") && Domain.safeParse(site).success ? { site, isAddress: false } : undefined;
}

/** A route domain, stored normalized. Routing a domain always includes its subdomains. */
export const RouteDomain = z.string().transform(normalizeDomain).pipe(Domain);

const routeFields = {
  id: z.string().min(1),
  vpnId: z.string().min(1),
  enabled: z.boolean(),
  note: z.string(),
  /** Goes through this VPN whatever the priority order: an exception for one shared address. Added later, hence the default. */
  pinned: z.boolean().default(false),
};

/** Routes by destination IP range. */
const CidrRule = z.object({ ...routeFields, kind: z.literal("cidr"), cidr: Cidr });
/** Routes by name: connections to the domain (and its subdomains) go through the VPN, resolved on the VPN side. */
const DomainRule = z.object({ ...routeFields, kind: z.literal("domain"), domain: RouteDomain });

/** Routes saved before domain routes existed have no `kind`; they're CIDR routes. */
const withKind = (value: unknown) =>
  typeof value === "object" && value !== null && !("kind" in value) ? { ...value, kind: "cidr" } : value;

export const RouteRule = z.preprocess(withKind, z.discriminatedUnion("kind", [CidrRule, DomainRule]));
export type RouteRule = z.infer<typeof RouteRule>;

export const newRoute = (cidr: string, vpnId: string): RouteRule => ({ id: crypto.randomUUID(), kind: "cidr", cidr, vpnId, enabled: true, note: "", pinned: false });

/** What the route points at, as shown in its input field. */
export const routeTarget = (route: RouteRule) => (route.kind === "cidr" ? route.cidr : route.domain);

/** Sets a route's destination from typed text: digits, dots and slashes make an IP range, anything else a domain. */
export function retarget(route: RouteRule, text: string): RouteRule {
  const { id, vpnId, enabled, note, pinned } = route;
  return /^[\d./\s]*$/.test(text) ? { id, vpnId, enabled, note, pinned, kind: "cidr", cidr: text } : { id, vpnId, enabled, note, pinned, kind: "domain", domain: text };
}

export const Config = z
  .object({
    version: z.literal(1),
    /** In the order the user sees them when they're off. */
    vpns: z.array(Vpn),
    routes: z.array(RouteRule),
    /**
     * VPN ids, highest priority first: when two connected VPNs cover an address, the higher one gets it.
     * VPNs missing from it rank by kind (see `rankVpns`). Added later, hence the default.
     */
    priority: z.array(z.string()).default([]),
  })
  .superRefine((config, ctx) => {
    const vpnIds = new Set<string>();
    config.vpns.forEach((vpn, index) => {
      if (vpnIds.has(vpn.id)) ctx.addIssue({ code: "custom", message: `Duplicate VPN id "${vpn.id}"`, path: ["vpns", index, "id"] });
      vpnIds.add(vpn.id);
    });

    const routeIds = new Set<string>();
    config.routes.forEach((route, index) => {
      if (routeIds.has(route.id)) ctx.addIssue({ code: "custom", message: `Duplicate route id "${route.id}"`, path: ["routes", index, "id"] });
      routeIds.add(route.id);
      if (!vpnIds.has(route.vpnId)) {
        ctx.addIssue({ code: "custom", message: `Route points at unknown VPN "${route.vpnId}"`, path: ["routes", index, "vpnId"] });
      }
    });
  })
  // A removed VPN leaves the priority with it; each VPN is listed once.
  .transform((config) => {
    const vpnIds = new Set(config.vpns.map((vpn) => vpn.id));
    return { ...config, priority: [...new Set(config.priority)].filter((id) => vpnIds.has(id)) };
  });
export type Config = z.infer<typeof Config>;

export const emptyConfig = (): Config => ({ version: 1, vpns: [], routes: [], priority: [] });

// --- Priority -------------------------------------------------------------

/**
 * Every VPN, highest priority first. VPNs never placed sit where you'd expect: ones that carry their own
 * network on top, ones that carry everything at the bottom, so a new all-traffic VPN never hides the others.
 */
export function rankVpns(config: Pick<Config, "vpns" | "priority">): Vpn[] {
  const byId = new Map(config.vpns.map((vpn) => [vpn.id, vpn]));
  const placed = config.priority.flatMap((id) => byId.get(id) ?? []);
  const loose = config.vpns.filter((vpn) => !config.priority.includes(vpn.id));
  return [...loose.filter((vpn) => !isBroad(vpn)), ...placed, ...loose.filter(isBroad)];
}

/** The priority with `id` moved directly above or below `target`. */
export function placeVpn(config: Pick<Config, "vpns" | "priority">, id: string, target: string, where: "above" | "below"): string[] {
  const ids = rankVpns(config).map((vpn) => vpn.id).filter((other) => other !== id);
  const at = ids.indexOf(target);
  if (at < 0) return config.priority;
  ids.splice(where === "above" ? at : at + 1, 0, id);
  return ids;
}

/** The priority with `id` back where its kind starts: on top if it carries its own network, at the bottom if it carries everything. */
export function settleVpn(config: Pick<Config, "vpns" | "priority">, id: string): string[] {
  const vpn = config.vpns.find((candidate) => candidate.id === id);
  if (!vpn) return config.priority;
  const ids = rankVpns(config).map((other) => other.id).filter((other) => other !== id);
  return isBroad(vpn) ? [...ids, id] : [id, ...ids];
}
