import { type Detection, VPN_KINDS } from "@repo/core";
import { request } from "node:https";
import { LAUNCHERS } from "@repo/vpns/engine";
import type { Probe, Target } from "@repo/vpn-sdk/engine";

/**
 * Works out a VPN's type from just its address, the way each vendor's own client starts: each kind with a
 * `detect` in LAUNCHERS probes it. Only the first bytes of each answer are read, and any certificate is
 * accepted: probing learns what the server is, it never trusts it.
 */

const TIMEOUT_MS = 5000;
const MAX_BODY = 64 * 1024;

const httpsProbe: Probe = ({ host, port, method, path, body, headers }) =>
  new Promise((resolve) => {
    const req = request(
      { host, port, method, path, headers: { ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) }, rejectUnauthorized: false, timeout: TIMEOUT_MS },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (text.length >= MAX_BODY) response.destroy();
        });
        const done = () => resolve({ status: response.statusCode ?? 0, location: String(response.headers.location ?? ""), body: text.slice(0, MAX_BODY) });
        response.on("end", done);
        response.on("close", done);
      },
    );
    // `timeout` only covers idle sockets; a server trickling bytes is cut off by the overall deadline too.
    const deadline = setTimeout(() => req.destroy(), TIMEOUT_MS);
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
    req.on("close", () => clearTimeout(deadline));
    req.end(body);
  });

/** "vpn.example.com" or "vpn.example.com:10443" → host and port (443 when none). */
export function splitAddress(address: string): Target {
  const match = /^(.+?)(?::(\d{1,5}))?$/.exec(address.trim());
  const host = match?.[1] ?? address.trim();
  return match?.[2] ? { host, port: Number(match[2]), explicitPort: true } : { host, port: 443, explicitPort: false };
}

/** Probes the address for every kind at once; when several recognise it, the first in VPN_KINDS order wins. */
export async function detectVpn(address: string, probe: Probe = httpsProbe): Promise<Detection> {
  const target = splitAddress(address);
  if (!target.host) return { kind: "unknown" };
  const results = await Promise.all(
    VPN_KINDS.map(async (kind) => {
      const found = await LAUNCHERS[kind].detect?.(target, probe);
      return found && { kind, ...found };
    }),
  );
  return results.find((result) => result !== undefined) ?? { kind: "unknown" };
}
