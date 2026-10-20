import { HostPort, isPinnable, isVpnKind, parseSite } from "@repo/core";
import { loadConfig, saveConfig } from "@repo/core/store";
import { detectVpn, type ConnectionManager } from "@repo/engine";
import { writingConfig } from "../config-writes.ts";
import { handle } from "./handle.ts";

const vpnIdOf = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid VPN id");
  return value;
};

/** Finding out what a VPN is, connecting it, answering what it asks, and where a site goes. */
export function registerVpnHandlers({ configPath, connections }: { configPath: string; connections: ConnectionManager }) {
  handle("vpn:detect", async (address) => {
    const parsed = HostPort.safeParse(address);
    return parsed.success ? detectVpn(parsed.data) : { kind: "unknown" as const };
  });

  // A pasted link keeps only its site: the path doesn't change where traffic goes.
  handle("route:check", async (text) => {
    const parsed = typeof text === "string" && text.length <= 2048 ? parseSite(text) : undefined;
    if (!parsed) return { site: null };
    return { site: parsed.site, vpnId: (await connections.routeFor(parsed)) ?? null };
  });

  handle("vpn:connect", async (vpnId, password) => connections.connect(vpnIdOf(vpnId), typeof password === "string" ? password : undefined));
  handle("vpn:disconnect", async (vpnId) => connections.disconnect(vpnIdOf(vpnId)));
  handle("vpn:statuses", async () => connections.statuses());
  handle("vpn:answer", async (vpnId, reply) => {
    if (reply !== null && (typeof reply !== "string" || reply.length > 256)) throw new Error("Invalid answer");
    connections.answer(vpnIdOf(vpnId), reply);
  });
  handle("vpn:reopen-sign-in", async (vpnId) => connections.reopenSignIn(vpnIdOf(vpnId)));
  // The kind and name pick a declared action; the action itself parses the input (vpn-sdk: implement).
  handle("vpn:action", async (kind, name, input) => {
    if (!isVpnKind(kind) || typeof name !== "string") throw new Error("Invalid action");
    return connections.runAction(kind, name, input);
  });

  // Only the pin the gateway actually presented can be trusted, never a value from the renderer.
  handle("vpn:trust-certificate", async (vpnIdInput) => {
    const vpnId = vpnIdOf(vpnIdInput);
    const pin = connections.presentedPin(vpnId);
    if (!pin) throw new Error("There's no certificate to trust for this VPN. Connect first.");
    return writingConfig(async () => {
      const config = await loadConfig(configPath);
      const vpns = config.vpns.map((vpn) => (vpn.id === vpnId && isPinnable(vpn) ? { ...vpn, serverCertPin: pin } : vpn));
      return saveConfig({ ...config, vpns }, configPath);
    });
  });
}
