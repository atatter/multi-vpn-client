/** Per-domain DNS for the host: points chosen domains at the helper's sing-box DNS listener. One implementation per OS. */
export interface DnsAdapter {
  /** Makes exactly these domains resolve through the helper's DNS listener. */
  set(domains: readonly string[]): Promise<void>;
  /** Removes every entry we created (including stale ones from a crash). */
  clear(): Promise<void>;
}

export { createResolverDns } from "./darwin.ts";
export { createResolvedDns } from "./linux.ts";
export { createNrptDns } from "./win32.ts";
