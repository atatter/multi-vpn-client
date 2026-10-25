import {
  ALL_TRAFFIC,
  networkOf,
  parseCidr,
  rangesToCidrs,
  union,
  type ServerRoutes,
} from '@repo/core';

/** Most networks a server's split tunnel is taken to send; more is noise, not a real network. */
const MAX_PUSHED_ROUTES = 1024;

/** Reads a client's record of what its server sent: "all", or one network per line (host bits cleared). */
export function parsePushedRoutes(text: string): ServerRoutes {
  const entries = text.split(/\s+/).filter(Boolean);
  if (entries.includes('all')) {
    return { all: true, cidrs: [] };
  }

  const cidrs = [...new Set(entries.flatMap((entry) => networkOf(entry) ?? []))].slice(
    0,
    MAX_PUSHED_ROUTES,
  );
  // A full tunnel is often sent in pieces, e.g. 0.0.0.0/1 and 128.0.0.0/1.
  const ranges = union(
    cidrs.flatMap((cidr) => {
      const parsed = parseCidr(cidr);
      return parsed.ok ? [parsed.range] : [];
    }),
  );
  const everything = rangesToCidrs(ranges).join() === ALL_TRAFFIC;

  return everything ? { all: true, cidrs: [] } : { all: false, cidrs };
}
