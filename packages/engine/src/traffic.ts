import { vpnOfOutbound, type StatsEndpoint, type TrafficSnapshot } from "@repo/core";
import { z } from "zod";

/**
 * Live traffic for the app's views, read from the host routing engine's Clash API (GET /connections),
 * which lists each open connection with the outbound it took ("vpn-<id>") and its byte counters.
 * Only VPN traffic passes through the routing engine, so the normal connection is never seen.
 */

/** The parts of a Clash API connection we read; checked, since it comes over the network. */
const ClashConnection = z.object({
  id: z.string(),
  upload: z.number(),
  download: z.number(),
  chains: z.array(z.string()),
  metadata: z.object({ host: z.string().optional(), destinationIP: z.string().optional() }),
});
type ClashConnection = z.infer<typeof ClashConnection>;
const ClashConnections = z.object({ connections: z.array(ClashConnection).nullish() });

const HISTORY_SECONDS = 60;
const DESTINATION_WINDOW_MS = 5 * 60_000;
const MAX_DESTINATIONS = 300;
const POLL_MS = 1000;


/**
 * Folds successive /connections results into rates and destinations. It keeps its own history but does no
 * I/O, so it can be tested without a routing engine: feed it each poll's connections, the connected VPNs and the time.
 */
export function createTrafficTally() {
  /** Bytes each open connection had at the last poll, so only the difference counts. */
  const seen = new Map<string, number>();
  const rates = new Map<string, number[]>();
  /** Per host and VPN, the bytes seen at each poll within the window, so totals cover only the last five minutes. */
  const destinations = new Map<string, { host: string; vpnId: string; samples: { at: number; bytes: number }[] }>();

  return {
    add(connections: readonly ClashConnection[], vpnIds: readonly string[], now: number): TrafficSnapshot {
      const second = new Map<string, number>();
      const open = new Set<string>();
      for (const connection of connections) {
        open.add(connection.id);
        // The VPN it went to, from its outbound; undefined for direct traffic.
        const vpnId = vpnOfOutbound(connection.chains[0] ?? "");
        const total = connection.upload + connection.download;
        const delta = Math.max(0, total - (seen.get(connection.id) ?? 0));
        seen.set(connection.id, total);
        if (!vpnId) continue;
        second.set(vpnId, (second.get(vpnId) ?? 0) + delta);
        const host = connection.metadata.host || connection.metadata.destinationIP || "";
        if (!host) continue;
        const key = `${vpnId} ${host}`;
        const entry = destinations.get(key) ?? { host, vpnId, samples: [] };
        if (delta > 0 || entry.samples.length === 0) entry.samples.push({ at: now, bytes: delta });
        destinations.set(key, entry);
      }
      for (const id of seen.keys()) if (!open.has(id)) seen.delete(id);

      // Every connected VPN gets a value each second, so a quiet one shows as quiet rather than missing.
      for (const id of rates.keys()) if (!vpnIds.includes(id)) rates.delete(id);
      for (const vpnId of vpnIds) rates.set(vpnId, [...(rates.get(vpnId) ?? []), second.get(vpnId) ?? 0].slice(-HISTORY_SECONDS));
      for (const [key, entry] of destinations) {
        entry.samples = entry.samples.filter((sample) => now - sample.at <= DESTINATION_WINDOW_MS);
        if (entry.samples.length === 0 || !vpnIds.includes(entry.vpnId)) destinations.delete(key);
      }

      const rows = [...destinations.values()].map(({ host, vpnId, samples }) => ({
        host,
        vpnId,
        bytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
        last: samples.at(-1)?.at ?? now,
      }));
      return { rates: Object.fromEntries(rates), destinations: rows.sort((a, b) => b.last - a.last).slice(0, MAX_DESTINATIONS) };
    },
  };
}

/**
 * Polls the routing engine once a second while VPNs are connected and reports each tally. A failed poll
 * (the engine is reloading, or an older helper without the API) is skipped quietly; the next one retries.
 */
export function createTrafficMonitor({
  endpoint,
  connectedVpns,
  onUpdate,
}: {
  endpoint: StatsEndpoint;
  connectedVpns: () => string[];
  onUpdate: (snapshot: TrafficSnapshot) => void;
}) {
  let timer: NodeJS.Timeout | undefined;
  let tally = createTrafficTally();
  /** Bumped on stop, so a poll still in flight then doesn't report after the reset. */
  let generation = 0;

  const poll = async () => {
    const mine = generation;
    const vpnIds = connectedVpns();
    try {
      const response = await fetch(`http://127.0.0.1:${endpoint.port}/connections`, {
        headers: { Authorization: `Bearer ${endpoint.secret}` },
        signal: AbortSignal.timeout(POLL_MS),
      });
      if (!response.ok) return;
      const body = ClashConnections.safeParse(await response.json());
      if (body.success && mine === generation) onUpdate(tally.add(body.data.connections ?? [], vpnIds, Date.now()));
    } catch {
      // Skipped; the next poll retries.
    }
  };

  return {
    /** Starts polling, if it isn't already. */
    start() {
      timer ??= setInterval(() => void poll(), POLL_MS);
    },
    /** Stops polling and forgets the history (nothing is connected anymore). */
    stop() {
      clearInterval(timer);
      timer = undefined;
      generation++;
      tally = createTrafficTally();
      onUpdate({ rates: {}, destinations: [] });
    },
  };
}
