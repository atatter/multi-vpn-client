import { networkInterfaces } from "node:os";

/**
 * The machine's own IPv6 subnets, e.g. "2001:db8:1:2:0:0:0:0/64", which stay reachable while IPv6 is blocked
 * (link-local ones are kept anyway). Masked to the network: an OS refuses a route whose address has host bits.
 */
export function localIpv6Networks(interfaces = networkInterfaces()): string[] {
  const networks = Object.values(interfaces).flatMap((addresses) =>
    (addresses ?? []).flatMap((address) => {
      if (address.family !== "IPv6" || address.internal || !address.cidr || /^fe[89ab]/i.test(address.address)) return [];
      return ipv6Network(address.cidr) ?? [];
    }),
  );
  return [...new Set(networks)];
}

/** "2001:db8::5/64" → "2001:db8:0:0:0:0:0:0/64"; undefined for anything else (e.g. an embedded IPv4 address). */
export function ipv6Network(cidr: string): string | undefined {
  const [address = "", prefixText = ""] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!/^\d{1,3}$/.test(prefixText) || prefix > 128) return undefined;
  const halves = address.split("::");
  if (halves.length > 2) return undefined;
  const groupsOf = (part: string | undefined) => (part ? part.split(":") : []);
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  const value = groups.reduce((sum, group) => (sum << 16n) | BigInt(`0x${group}`), 0n);
  const network = value & (((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n));
  const hextets = Array.from({ length: 8 }, (_, index) => ((network >> BigInt(16 * (7 - index))) & 0xffffn).toString(16));
  return `${hextets.join(":")}/${prefix}`;
}
