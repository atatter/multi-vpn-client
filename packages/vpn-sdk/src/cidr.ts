/**
 * IPv4 CIDR math on inclusive integer ranges.
 *
 * A "range set" is a sorted list of disjoint, non-adjacent ranges. Every
 * operation here returns a normalized range set, so results can be compared
 * and converted back to the minimal list of CIDRs with `rangesToCidrs`.
 */

/** Inclusive [first, last] address range, addresses as unsigned 32-bit integers. */
export type Range = readonly [first: number, last: number];

const OCTET = /^(0|[1-9]\d{0,2})$/;

export type ParsedCidr = { ok: true; cidr: string; range: Range } | { ok: false; error: string };

/** Strictly splits "a.b.c.d/len" (len 0–32, plain digits). A bare address only when `bareMeans32`. */
function splitCidr(
  input: string,
  bareMeans32: boolean,
): { address: number; prefix: number } | undefined {
  const [address, length, ...rest] = input.trim().split('/');
  const value = address === undefined ? undefined : parseIpv4(address);
  if (value === undefined || rest.length > 0) {
    return undefined;
  }
  if (length === undefined) {
    return bareMeans32 ? { address: value, prefix: 32 } : undefined;
  }
  if (!/^\d{1,2}$/.test(length) || Number(length) > 32) {
    return undefined;
  }

  return { address: value, prefix: Number(length) };
}

const networkAddress = (address: number, prefix: number) =>
  address - (address % 2 ** (32 - prefix));

/** Parses "a.b.c.d/len" (or a bare address, meaning /32) and rejects host bits. */
export function parseCidr(input: string): ParsedCidr {
  const split = splitCidr(input, true);
  if (!split) {
    return { ok: false, error: 'Expected an IPv4 CIDR like 10.20.0.0/16' };
  }

  const { address, prefix } = split;
  const network = networkAddress(address, prefix);
  const cidr = `${formatIpv4(network)}/${prefix}`;
  if (network !== address) {
    return { ok: false, error: `Host bits are set. Did you mean ${cidr}?` };
  }

  return { ok: true, cidr, range: [network, network + 2 ** (32 - prefix) - 1] };
}

/** Zeroes the host bits: "192.168.1.23/24" → "192.168.1.0/24". For interface addresses, not user input. */
export function networkOf(interfaceCidr: string): string | undefined {
  const split = splitCidr(interfaceCidr, false);
  return split && `${formatIpv4(networkAddress(split.address, split.prefix))}/${split.prefix}`;
}

/** A plain IPv4 address, no prefix. */
export const isIpv4 = (value: string) => parseIpv4(value.trim()) !== undefined;

function parseIpv4(address: string): number | undefined {
  const octets = address.split('.');
  if (octets.length !== 4) {
    return undefined;
  }

  let value = 0;

  for (const octet of octets) {
    if (!OCTET.test(octet) || Number(octet) > 255) {
      return undefined;
    }

    value = value * 256 + Number(octet);
  }

  return value;
}

function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** Normalizes any list of ranges into a range set. */
export function union(ranges: readonly Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];

  for (const [first, last] of sorted) {
    const previous = merged.at(-1);
    if (previous && first <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], last);
    } else {
      merged.push([first, last]);
    }
  }

  return merged;
}

/** Addresses in `from` that are not in `remove`. */
export function subtract(from: readonly Range[], remove: readonly Range[]): Range[] {
  const holes = union(remove);
  const result: Range[] = [];

  for (const [first, last] of union(from)) {
    let cursor = first;

    for (const [holeFirst, holeLast] of holes) {
      if (holeLast < cursor || holeFirst > last) {
        continue;
      }

      if (holeFirst > cursor) {
        result.push([cursor, holeFirst - 1]);
      }

      cursor = holeLast + 1;
    }

    if (cursor <= last) {
      result.push([cursor, last]);
    }
  }

  return result;
}

/** Addresses present in both `a` and `b`. */
export function intersect(a: readonly Range[], b: readonly Range[]): Range[] {
  return subtract(a, subtract(a, b));
}

/** Converts a range set into the minimal list of CIDRs that covers it exactly. */
export function rangesToCidrs(ranges: readonly Range[]): string[] {
  const cidrs: string[] = [];

  for (const [first, last] of union(ranges)) {
    let cursor = first;

    while (cursor <= last) {
      // Largest block that is aligned at `cursor` and still fits before `last`.
      let bits = 0;

      while (bits < 32 && cursor % 2 ** (bits + 1) === 0 && cursor + 2 ** (bits + 1) - 1 <= last) {
        bits++;
      }

      cidrs.push(`${formatIpv4(cursor)}/${32 - bits}`);
      cursor += 2 ** bits;
    }
  }

  return cidrs;
}
