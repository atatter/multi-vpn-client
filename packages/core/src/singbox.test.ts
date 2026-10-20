import { describe, expect, it } from "vitest";
import type { VpnTunnel } from "./helper-protocol.ts";
import type { HostRoutes } from "./helper-protocol.ts";
import {
  containerProxyConfig,
  FAKEIP_RANGE,
  HOST_DNS_PORT,
  hostSingBoxConfig,
  LINUX_DNS_ADDRESS,
  resolverDomains,
  routedDnsDomains,
  TUN_ADDRESS,
  TUN_ADDRESS_IPV6,
  TUN_DNS_ADDRESS,
  type HostOs,
} from "./singbox.ts";

const tunnel = (vpnId: string, overrides: Partial<VpnTunnel> = {}): VpnTunnel => ({
  vpnId,
  port: 41000,
  username: "u",
  password: "p",
  cidrs: ["10.20.0.0/16"],
  dns: { servers: ["10.20.0.53"], domains: ["client-a.internal"] },
  ...overrides,
});

/** The config for `routes` (IPv6 not blocked unless they say so). */
const configFor = (routes: Omit<HostRoutes, "blockIpv6"> & { blockIpv6?: boolean }, os: HostOs = "darwin", localIpv6: string[] = []) =>
  hostSingBoxConfig({ blockIpv6: false, ...routes }, { os, cachePath: "/work/cache.db", localIpv6 });

describe("hostSingBoxConfig", () => {
  it("routes each VPN's CIDRs through the TUN into its container's SOCKS port", () => {
    const config = configFor({ tunnels: [tunnel("a"), tunnel("b", { port: 41001, cidrs: ["172.31.0.0/16"], dns: { servers: [], domains: [] } })], domains: [] });

    expect(config.inbounds).toContainEqual(
      expect.objectContaining({
        type: "tun",
        stack: "gvisor",
        auto_route: true,
        strict_route: false,
        dns_mode: "disabled",
        route_address: ["10.20.0.0/16", "172.31.0.0/16", `${TUN_DNS_ADDRESS}/32`],
      }),
    );
    expect(config.outbounds).toContainEqual({
      type: "socks",
      tag: "vpn-b",
      server: "127.0.0.1",
      server_port: 41001,
      username: "u",
      password: "p",
      udp_over_tcp: true,
    });
    expect(config.route.rules).toContainEqual({ ip_cidr: ["172.31.0.0/16"], action: "route", outbound: "vpn-b" });
  });

  it("sends each VPN's DNS domains to its DNS server through the tunnel, with no IPv6 answers, which would go around it", () => {
    const config = configFor({ tunnels: [tunnel("a")], domains: [] });
    expect(config.route.rules[0]).toEqual({ inbound: "tun-in", ip_cidr: [`${TUN_DNS_ADDRESS}/32`], port: 53, action: "hijack-dns" });
    expect(config.dns.servers).toContainEqual({ type: "tcp", tag: "dns-a", server: "10.20.0.53", detour: "vpn-a" });
    expect(config.dns.rules).toEqual([
      { domain_suffix: ["client-a.internal"], query_type: ["AAAA"], action: "predefined", rcode: "NOERROR" },
      { domain_suffix: ["client-a.internal"], action: "route", server: "dns-a" },
    ]);
  });

  it("refuses IPv6 at once while a VPN carries all traffic, keeping link-local, multicast and the local subnets", () => {
    const tun = (blockIpv6: boolean) =>
      configFor({ tunnels: [tunnel("a")], domains: [], blockIpv6 }, "linux", ["2001:db8:1:2:0:0:0:0/64"]).inbounds.find((inbound) => inbound.type === "tun");
    expect(tun(true)).toMatchObject({
      address: [TUN_ADDRESS, TUN_ADDRESS_IPV6],
      route_address: ["10.20.0.0/16", "::/1", "8000::/1"],
      route_exclude_address: ["fe80::/10", "ff00::/8", "2001:db8:1:2:0:0:0:0/64"],
    });
    const blocked = configFor({ tunnels: [tunnel("a")], domains: [], blockIpv6: true }, "linux");
    expect(blocked.route.rules[0]).toEqual({ ip_version: 6, action: "reject", no_drop: true });

    // Otherwise IPv6 is left alone: no VPN claims it.
    expect(tun(false)).toMatchObject({ address: [TUN_ADDRESS], route_address: ["10.20.0.0/16"] });
    expect(tun(false)).not.toHaveProperty("route_exclude_address");
    expect(configFor({ tunnels: [tunnel("a")], domains: [] }, "linux").route.rules.some((rule) => "ip_version" in rule)).toBe(false);
  });

  it("never adds a TUN without routes, since an empty route list would capture all traffic", () => {
    const config = configFor({ tunnels: [tunnel("a", { cidrs: [], dns: { servers: [], domains: [] } })], domains: [] });
    expect(config.inbounds.some((inbound) => inbound.type === "tun")).toBe(false);
  });

  it("answers DNS inside the TUN on macOS, so no other program can hold its address", () => {
    const config = configFor({ tunnels: [tunnel("a")], domains: [] });
    expect(config.inbounds.map((inbound) => inbound.type)).toEqual(["tun"]);
    expect(config.inbounds[0]).toMatchObject({ route_address: ["10.20.0.0/16", `${TUN_DNS_ADDRESS}/32`] });
  });

  it("adds no DNS listener when no domain needs it", () => {
    const config = configFor({ tunnels: [tunnel("a", { dns: { servers: [], domains: [] } })], domains: [] });
    expect(config.inbounds.map((inbound) => inbound.type)).toEqual(["tun"]);
    expect(config.route.rules).toEqual([{ ip_cidr: ["10.20.0.0/16"], action: "route", outbound: "vpn-a" }]);
  });

  it("persists placeholder IPs across reloads", () => {
    expect(configFor({ tunnels: [tunnel("a")], domains: [] }).experimental).toEqual({
      cache_file: { enabled: true, path: "/work/cache.db", store_fakeip: true },
    });
  });

  it("reports live connections on loopback, behind the session's secret, to the loopback origin only", () => {
    const { experimental } = configFor({ tunnels: [tunnel("a")], domains: [], stats: { port: 45001, secret: "s3cret_value" } });
    expect(experimental.clash_api).toEqual({ external_controller: "127.0.0.1:45001", secret: "s3cret_value", access_control_allow_origin: ["http://127.0.0.1"] });
  });

  it("sends direct traffic out of the real network card, never back into the TUN", () => {
    expect(configFor({ tunnels: [tunnel("a")], domains: [] }).route.auto_detect_interface).toBe(true);
  });

  it("skips DNS routing for VPNs without a DNS server", () => {
    const config = configFor({ tunnels: [tunnel("a", { dns: { servers: [], domains: ["client-a.internal"] } })], domains: [] });
    expect(config.dns.rules).toEqual([]);
  });
});

describe("hostSingBoxConfig: domain routes", () => {
  const routes = {
    tunnels: [tunnel("a", { cidrs: [] }), tunnel("b", { port: 41001, cidrs: ["10.30.0.0/16"], dns: { servers: [], domains: [] } })],
    domains: [
      { vpnId: "b", domain: "argo.lab.example" },
      { vpnId: "a", domain: "lab.example" },
    ],
  };

  it("answers A lookups for routed domains with placeholder IPs the TUN captures, and other lookups with nothing", () => {
    const config = configFor(routes);
    expect(config.dns.servers).toContainEqual({ type: "fakeip", tag: "fakeip", inet4_range: FAKEIP_RANGE });
    expect(config.dns.rules.slice(0, 2)).toEqual([
      { domain_suffix: ["argo.lab.example", "lab.example"], query_type: ["A"], action: "route", server: "fakeip" },
      { domain_suffix: ["argo.lab.example", "lab.example"], action: "predefined", rcode: "NOERROR" },
    ]);
    expect(config.inbounds.find((inbound) => inbound.type === "tun")).toMatchObject({ route_address: ["10.30.0.0/16", FAKEIP_RANGE, `${TUN_DNS_ADDRESS}/32`] });
  });

  it("routes by name in priority order, before IP rules", () => {
    expect(configFor(routes).route.rules).toEqual([
      { inbound: "tun-in", ip_cidr: [`${TUN_DNS_ADDRESS}/32`], port: 53, action: "hijack-dns" },
      { domain_suffix: ["argo.lab.example"], action: "route", outbound: "vpn-b" },
      { domain_suffix: ["lab.example"], action: "route", outbound: "vpn-a" },
      { ip_cidr: ["10.30.0.0/16"], action: "route", outbound: "vpn-b" },
    ]);
  });

  it("captures the placeholder range even when no VPN has IP routes", () => {
    const config = configFor({ tunnels: [tunnel("a", { cidrs: [] })], domains: [{ vpnId: "a", domain: "x.example" }] });
    expect(config.inbounds.find((inbound) => inbound.type === "tun")).toMatchObject({ route_address: [FAKEIP_RANGE, `${TUN_DNS_ADDRESS}/32`] });
  });

  it("adds no placeholder DNS without domain routes", () => {
    const config = configFor({ tunnels: [tunnel("a")], domains: [] });
    expect(config.dns.servers.some((server) => server.type === "fakeip")).toBe(false);
  });

  it("sends both domain routes and VPN DNS domains to the helper's resolver", () => {
    expect(resolverDomains(routes)).toEqual(["argo.lab.example", "lab.example", "client-a.internal"]);
    expect(resolverDomains({ tunnels: [tunnel("a")], domains: [{ vpnId: "a", domain: "client-a.internal" }] })).toEqual(["client-a.internal"]);
  });
});

describe("hostSingBoxConfig per OS", () => {
  const routes: HostRoutes = { blockIpv6: false, tunnels: [tunnel("a", { cidrs: [] })], domains: [{ vpnId: "a", domain: "x.example" }] };

  it("Linux: named TUN, its own routing table, DNS listener on the dummy interface's address", () => {
    const config = configFor(routes, "linux");
    expect(config.inbounds).toEqual([
      expect.objectContaining({ type: "tun", interface_name: "mvpn0", iproute2_table_index: 5853, iproute2_rule_index: 9520 }),
      { type: "direct", tag: "dns-in", listen: LINUX_DNS_ADDRESS, listen_port: HOST_DNS_PORT },
    ]);
  });

  it("Windows: answers DNS inside the TUN, since NRPT can't name a port", () => {
    const config = configFor(routes, "win32");
    expect(config.inbounds).toEqual([
      expect.objectContaining({ type: "tun", interface_name: "mvpn", route_address: [FAKEIP_RANGE, `${TUN_DNS_ADDRESS}/32`] }),
    ]);
    expect(config.route.rules[0]).toEqual({ inbound: "tun-in", ip_cidr: [`${TUN_DNS_ADDRESS}/32`], port: 53, action: "hijack-dns" });
  });

  it("Windows: VPN DNS domains alone still bring up the TUN for the DNS address", () => {
    const config = configFor({ tunnels: [tunnel("a", { cidrs: [] })], domains: [] }, "win32");
    expect(config.inbounds).toEqual([expect.objectContaining({ type: "tun", route_address: [`${TUN_DNS_ADDRESS}/32`] })]);
  });
});

describe("routedDnsDomains", () => {
  it("includes only domains of VPNs that have a DNS server, once each", () => {
    expect(
      routedDnsDomains([
        tunnel("a"),
        tunnel("b", { dns: { servers: [], domains: ["no-server.example"] } }),
        tunnel("c", { dns: { servers: ["10.0.0.53"], domains: ["client-a.internal", "c.example"] } }),
      ]),
    ).toEqual(["client-a.internal", "c.example"]);
  });
});

describe("containerProxyConfig", () => {
  it("serves an authenticated SOCKS proxy that exits through the container's routes", () => {
    expect(containerProxyConfig({ username: "u", password: "p" })).toEqual({
      log: { level: "warn" },
      inbounds: [{ type: "socks", tag: "socks-in", listen: "0.0.0.0", listen_port: 1080, users: [{ username: "u", password: "p" }] }],
      outbounds: [{ type: "direct", tag: "direct" }],
    });
  });
});
