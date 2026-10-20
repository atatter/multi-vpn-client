import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import type { HostReserved, ReservedRange } from "./compile.ts";
import { vpnHosts, type Vpn } from "@repo/vpns";
import { networkOf } from "@repo/vpn-sdk/cidr";

/**
 * Node-only discovery of the ranges that must never be routed into a VPN.
 * Import via "@repo/core/host".
 */

/** IPv4 subnets of this machine's physical/LAN interfaces, so a client range can't cut off the local network. */
export function localNetworks(interfaces = networkInterfaces()): ReservedRange[] {
  const reserved: ReservedRange[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !address.cidr) continue;
      const network = networkOf(address.cidr);
      if (network) reserved.push({ cidr: network, label: `Local network (${name})`, local: true });
    }
  }
  return reserved;
}

/**
 * At most this many addresses per VPN host. The answer comes from the local network's DNS, so without a cap it could
 * keep any number of addresses out of every VPN; a VPN server's name has a handful.
 */
const MAX_HOST_ADDRESSES = 4;

/**
 * Resolves every host each VPN connects to (gateway, portal, endpoint…) to /32s, at most MAX_HOST_ADDRESSES each.
 * A rule covering one would send the tunnel's own packets into a tunnel, so
 * they always go direct. Unresolvable hosts are reported, not thrown, so the
 * UI can show them.
 */
export async function gatewayAddresses(
  vpns: readonly Vpn[],
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true, family: 4 })).map((entry) => entry.address),
): Promise<HostReserved> {
  const targets = vpns.flatMap((vpn) => vpnHosts(vpn).map((host) => ({ vpn, host })));
  const results = await Promise.all(
    targets.map(async ({ vpn, host }) => {
      try {
        return { vpn, host, addresses: (await resolve(host)).slice(0, MAX_HOST_ADDRESSES) };
      } catch {
        return { vpn, host, addresses: [] };
      }
    }),
  );
  return {
    reserved: results.flatMap(({ vpn, addresses }) =>
      addresses.map((address) => ({ cidr: `${address}/32`, label: `${vpn.name} gateway` })),
    ),
    unresolved: results.filter(({ addresses }) => addresses.length === 0).map(({ vpn, host }) => ({ vpnId: vpn.id, host })),
  };
}

/** Everything that must stay direct on this machine: local subnets plus every VPN gateway. */
export async function hostReserved(vpns: readonly Vpn[]): Promise<HostReserved> {
  const gateways = await gatewayAddresses(vpns);
  return { reserved: [...localNetworks(), ...gateways.reserved], unresolved: gateways.unresolved };
}
