import type { HostRoutes, VpnTunnel } from "./helper-protocol.ts";

/**
 * sing-box config builders (pure). The host runs one sing-box with a TUN that
 * captures only the compiled CIDRs and forwards each VPN's share over SOCKS to
 * that VPN's container; each container runs a tiny sing-box SOCKS server that
 * exits through the container's own (VPN) routes. UDP rides over the same TCP
 * connection (sing-box UDP-over-TCP), so one published port per VPN is enough.
 *
 * Domain routes use placeholder ("fake") IPs: lookups for a routed domain get
 * an address from FAKEIP_RANGE, which the TUN captures; sing-box maps it back
 * to the name and hands the connection to that VPN's container by name, where
 * the real address is resolved through the VPN.
 */

/** Port SOCKS listens on inside every VPN container. */
export const CONTAINER_SOCKS_PORT = 1080;

/** Linux: port of the DNS listener on LINUX_DNS_ADDRESS, which systemd-resolved's per-domain settings point at. */
export const HOST_DNS_PORT = 53530;

/** Address of the host TUN; a benchmark-range /30 that corporate networks don't use. */
export const TUN_ADDRESS = "198.18.0.1/30";
/** The TUN's IPv6 address (private), only while it takes IPv6 in to refuse it. */
export const TUN_ADDRESS_IPV6 = "fdfe:dcba:9876::1/126";

/** All of IPv6 except link-local and multicast, which stay on the local network like the machine's own subnets. */
const IPV6_ROUTES = ["::/1", "8000::/1"];
const IPV6_LOCAL = ["fe80::/10", "ff00::/8"];

/** Placeholder addresses handed out for routed domains (same benchmark block, clear of the TUN). */
export const FAKEIP_RANGE = "198.19.0.0/16";

/**
 * Docker networks for the VPN containers, a small one each. Inside the reserved block, so no real network
 * clashes with a container's own, and no VPN's routes claim it.
 */
export const CONTAINER_NETWORKS = "198.18.128.0/17";

/** The whole block the addresses above live in; IP routes must never claim it. */
export const ROUTING_RESERVED_RANGE = "198.18.0.0/15";

/**
 * Linux: the DNS listener's address, owned by a dummy interface that carries the
 * systemd-resolved settings. resolved may pin its query socket to that interface,
 * and only an address the interface itself owns is then still delivered locally.
 */
export const LINUX_DNS_ADDRESS = "198.18.0.5";

/**
 * macOS and Windows: the DNS address per-domain settings point at, inside the TUN, where sing-box answers on port 53.
 * No other program can hold it, unlike a loopback port (Tailscale holds 127.0.0.1:53530 on macOS). Windows' NRPT
 * can't name a port anyway.
 */
export const TUN_DNS_ADDRESS = "198.18.0.2";

/** Fixed TUN names (Linux, Windows), so a crashed run's leftovers are reused or cleaned up instead of piling up. */
export const TUN_NAME = { linux: "mvpn0", win32: "mvpn" } as const;

/** Linux policy routing: sing-box owns rules RULE_INDEX…RULE_INDEX+10 and deletes them on start, so stay clear of its defaults (2022/9000). */
export const LINUX_ROUTE_TABLE = 5853;
export const LINUX_RULE_INDEX = 9520;

export type HostOs = "darwin" | "linux" | "win32";

/** VPN DNS domains that resolve through a tunnel: only VPNs that have a DNS server route their domains. */
export const routedDnsDomains = (tunnels: readonly VpnTunnel[]) => [
  ...new Set(tunnels.flatMap((tunnel) => (tunnel.dns.servers.length > 0 ? tunnel.dns.domains : []))),
];

/** Every domain whose lookups must reach the host sing-box: domain routes plus VPN DNS domains. */
export const resolverDomains = ({ tunnels, domains }: Pick<HostRoutes, "tunnels" | "domains">) => [...new Set([...domains.map((route) => route.domain), ...routedDnsDomains(tunnels)])];

/** A VPN's outbound tag in the routing engine, and back: live traffic tells VPNs apart by it. */
const outboundTag = (vpnId: string) => `vpn-${vpnId}`;
export const vpnOfOutbound = (tag: string) => (tag.startsWith(outboundTag("")) ? tag.slice(outboundTag("").length) : undefined);
const dnsTag = (vpnId: string) => `dns-${vpnId}`;

/**
 * The host sing-box config. `cachePath` persists the placeholder-IP table, so names the OS
 * already cached keep working across reloads and restarts. `localIpv6`: the machine's own IPv6 subnets,
 * which stay reachable while IPv6 is blocked.
 */
export function hostSingBoxConfig(routes: HostRoutes, { os, cachePath, localIpv6 }: { os: HostOs; cachePath: string; localIpv6: readonly string[] }) {
  const { tunnels, domains, blockIpv6 } = routes;
  const routed = tunnels.filter((tunnel) => tunnel.cidrs.length > 0);
  const withDns = tunnels.filter((tunnel) => tunnel.dns.servers.length > 0 && tunnel.dns.domains.length > 0);
  const routedNames = domains.map((route) => route.domain);
  const needsDns = resolverDomains(routes).length > 0;
  const dnsInTun = os !== "linux" && needsDns;
  const routeAddress = [
    ...routed.flatMap((tunnel) => tunnel.cidrs),
    ...(domains.length > 0 ? [FAKEIP_RANGE] : []),
    ...(dnsInTun ? [`${TUN_DNS_ADDRESS}/32`] : []),
    ...(blockIpv6 ? IPV6_ROUTES : []),
  ];
  const vpnDnsDomains = routedDnsDomains(tunnels);

  return {
    log: { level: "warn", timestamp: false },
    dns: {
      servers: [
        { type: "local", tag: "local" },
        ...(domains.length > 0 ? [{ type: "fakeip", tag: "fakeip", inet4_range: FAKEIP_RANGE }] : []),
        ...withDns.map((tunnel) => ({ type: "tcp", tag: dnsTag(tunnel.vpnId), server: tunnel.dns.servers[0], detour: outboundTag(tunnel.vpnId) })),
      ],
      rules: [
        // Routed domains first: placeholders for IPv4, empty answers for everything else (no IPv6 placeholders).
        ...(domains.length > 0
          ? [
              { domain_suffix: routedNames, query_type: ["A"], action: "route", server: "fakeip" },
              { domain_suffix: routedNames, action: "predefined", rcode: "NOERROR" },
            ]
          : []),
        // No VPN carries IPv6, so a VPN's own names get no IPv6 addresses: the machine would reach them outside it.
        ...(vpnDnsDomains.length > 0 ? [{ domain_suffix: vpnDnsDomains, query_type: ["AAAA"], action: "predefined", rcode: "NOERROR" }] : []),
        ...withDns.map((tunnel) => ({ domain_suffix: tunnel.dns.domains, action: "route", server: dnsTag(tunnel.vpnId) })),
      ],
      final: "local",
    },
    inbounds: [
      // An empty route_address means "route everything", so the TUN only exists when there is something to route.
      ...(routeAddress.length > 0
        ? [
            {
              type: "tun",
              tag: "tun-in",
              ...(os === "darwin" ? {} : { interface_name: TUN_NAME[os] }),
              ...(os === "linux" ? { iproute2_table_index: LINUX_ROUTE_TABLE, iproute2_rule_index: LINUX_RULE_INDEX } : {}),
              address: [TUN_ADDRESS, ...(blockIpv6 ? [TUN_ADDRESS_IPV6] : [])],
              // Userspace TCP/IP: the default hands TCP back to the kernel as incoming traffic on the
              // TUN, which host firewalls (ufw, firewalld, Windows Firewall) drop.
              stack: "gvisor",
              auto_route: true,
              // true would also cut off the host's IPv6 on Linux and add firewall filters on Windows.
              strict_route: false,
              // DNS goes through per-domain OS settings instead; the TUN must not become the system DNS.
              dns_mode: "disabled",
              route_address: routeAddress,
              ...(blockIpv6 ? { route_exclude_address: [...IPV6_LOCAL, ...localIpv6] } : {}),
            },
          ]
        : []),
      ...(needsDns && !dnsInTun
        ? [{ type: "direct", tag: "dns-in", listen: LINUX_DNS_ADDRESS, listen_port: HOST_DNS_PORT }]
        : []),
    ],
    outbounds: [
      { type: "direct", tag: "direct" },
      ...tunnels.map((tunnel) => ({
        type: "socks",
        tag: outboundTag(tunnel.vpnId),
        server: "127.0.0.1",
        server_port: tunnel.port,
        username: tunnel.username,
        password: tunnel.password,
        udp_over_tcp: true,
      })),
    ],
    route: {
      rules: [
        // Refused at once (a TCP reset, "unreachable" for UDP), so apps fall back to IPv4 without waiting. no_drop
        // keeps it that way: by default sing-box starts silently dropping after 50 refusals in 30 seconds.
        ...(blockIpv6 ? [{ ip_version: 6, action: "reject", no_drop: true }] : []),
        ...(dnsInTun ? [{ inbound: "tun-in", ip_cidr: [`${TUN_DNS_ADDRESS}/32`], port: 53, action: "hijack-dns" }] : []),
        ...(needsDns && !dnsInTun ? [{ inbound: "dns-in", action: "hijack-dns" }] : []),
        // In priority order; sing-box restores the name from the placeholder IP before matching.
        ...domains.map((route) => ({ domain_suffix: [route.domain], action: "route", outbound: outboundTag(route.vpnId) })),
        ...routed.map((tunnel) => ({ ip_cidr: tunnel.cidrs, action: "route", outbound: outboundTag(tunnel.vpnId) })),
      ],
      final: "direct",
      // Required since 1.14; only used if something dials a hostname, which our IP-only outbounds don't.
      default_domain_resolver: "local",
      // Direct traffic leaves through the real network card, not the TUN: with a VPN carrying everything,
      // the TUN's routes cover almost everything, and "direct" would otherwise loop back into it.
      auto_detect_interface: true,
    },
    experimental: {
      cache_file: { enabled: true, path: cachePath, store_fakeip: true },
      // Live connections for the app's traffic views. Loopback only, behind a secret, and only a loopback
      // origin may call it from a browser (an empty list would mean any origin).
      ...(routes.stats
        ? { clash_api: { external_controller: `127.0.0.1:${routes.stats.port}`, secret: routes.stats.secret, access_control_allow_origin: ["http://127.0.0.1"] } }
        : {}),
    },
  };
}

/** SOCKS server inside a VPN container; credentials keep other local processes from borrowing the tunnel. */
export function containerProxyConfig({ username, password }: { username: string; password: string }) {
  return {
    log: { level: "warn" },
    inbounds: [{ type: "socks", tag: "socks-in", listen: "0.0.0.0", listen_port: CONTAINER_SOCKS_PORT, users: [{ username, password }] }],
    outbounds: [{ type: "direct", tag: "direct" }],
  };
}
