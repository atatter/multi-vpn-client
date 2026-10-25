import { z } from 'zod';
import { isIpv4, parseCidr } from './cidr.ts';

/**
 * The building blocks of the saved config: field schemas the VPN kinds (@repo/vpns) and core's
 * config share, and the settings every VPN has. Optional text fields use "" for "not set".
 */

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HOST = `${LABEL}(?:\\.${LABEL})*`;
const HOST_RE = new RegExp(`^${HOST}$`);
const HOST_PORT_RE = new RegExp(`^(${HOST})(?::(\\d{1,5}))?$`);

const HOST_MESSAGE = 'Enter a host name or IP, e.g. vpn.example.com (no https://)';

const validPort = (value: string) => {
  const port = HOST_PORT_RE.exec(value)?.[2];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
};

/** "host" or "host:port". */
export const HostPort = z
  .string()
  .trim()
  .regex(HOST_PORT_RE, HOST_MESSAGE)
  .refine(validPort, 'Port must be between 1 and 65535');

/** The hosts of "host" / "host:port" addresses, without ports; empty ones are dropped. */
export const bareHosts = (addresses: readonly string[]) =>
  addresses
    .map((address) => HOST_PORT_RE.exec(address.trim())?.[1])
    .filter((host): host is string => !!host);

export const Ipv4 = z.string().refine(isIpv4, 'Expected an IPv4 address');
export const Domain = z.string().regex(HOST_RE, 'Expected a domain, e.g. corp.example');

export const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

/** Most DNS servers / domains a VPN may have; the helper protocol enforces the same limits. */
export const MAX_DNS_SERVERS = 8;
export const MAX_DNS_DOMAINS = 256;

export const DnsSettings = z.object({
  /** Empty = use the DNS servers the VPN pushes. */
  servers: z.array(Ipv4).max(MAX_DNS_SERVERS, `At most ${MAX_DNS_SERVERS} DNS servers`),
  /** Domains resolved through this VPN, e.g. "client-a.internal". */
  domains: z.array(Domain).max(MAX_DNS_DOMAINS, `At most ${MAX_DNS_DOMAINS} domains`),
});
export type DnsSettings = z.infer<typeof DnsSettings>;

/** A route CIDR, stored in canonical form ("10.0.0.5" → "10.0.0.5/32"). */
export const Cidr = z.string().transform((value, ctx) => {
  const parsed = parseCidr(value);
  if (parsed.ok) {
    return parsed.cidr;
  }

  ctx.addIssue(parsed.error);

  return z.NEVER;
});

// --- Traffic ---------------------------------------------------------------

/**
 * What goes through a VPN:
 * - "official": what its server sends, like the vendor's own app (learned on the first connect), plus the VPN's own routes;
 * - "sites": only the VPN's own routes;
 * - "all": everything, whatever the server sends.
 */
export const TrafficMode = z.enum(['official', 'sites', 'all']);
export type TrafficMode = z.infer<typeof TrafficMode>;

/** What a VPN's server sent on the last connect: everything (no split tunnel), or these networks. */
export const ServerRoutes = z.object({
  all: z.boolean(),
  cidrs: z.array(Cidr),
});
export type ServerRoutes = z.infer<typeof ServerRoutes>;

// --- Settings every VPN has ------------------------------------------------

/** Settings every VPN has, whatever its kind; each kind's schema spreads them in. */
export const commonFields = {
  id: z.string().min(1),
  name: requiredText('Name'),
  dns: DnsSettings,
  /** Keep the login password in the secret store instead of asking on every connect. */
  rememberPassword: z.boolean(),
  /** Raw extra options passed to the engine; meaning depends on the kind. */
  advanced: z.string(),
  /** Added later: VPNs saved before chose their routes themselves, hence "sites". New VPNs start with "official". */
  traffic: TrafficMode.default('sites'),
  /** Learned on connect; null until the first one. Written by the app, not the user. */
  serverRoutes: ServerRoutes.nullable().default(null),
};
export type CommonSettings = z.output<z.ZodObject<typeof commonFields>>;
