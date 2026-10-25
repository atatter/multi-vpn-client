import { HELPER_PORT, NO_ROUTES, type StatsEndpoint, type TrafficSnapshot } from '@repo/core';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { openHelperSession, type HelperSession } from '../helper-client.ts';
import { readHelperToken } from '../helper-install/index.ts';
import { createTrafficMonitor } from '../traffic.ts';
import type { RoutePlan } from './host-routes.ts';
import type { Exclusive } from './queue.ts';

/** A free loopback port, for the routing engine's stats endpoint. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        address && typeof address === 'object'
          ? resolve(address.port)
          : reject(new Error('No free port')),
      );
    });
  });

/**
 * The host side of connections: the session with the installed network helper, which routes into
 * the containers, and the traffic monitor reading its stats. Use it only inside the manager's queue.
 */
export function createHost(deps: {
  dataDir: string;
  /** The manager's queue: the helper going away is handled in it. */
  exclusive: Exclusive;
  /** VPNs with a container, for the traffic monitor. */
  connectedVpns: () => string[];
  /** Live traffic, about once a second while anything is connected. */
  onTraffic: (snapshot: TrafficSnapshot) => void;
  /** The helper session ended unexpectedly, so the helper has removed our routes. Runs in the queue. */
  onHelperLost: () => Promise<void>;
}) {
  let helper: HelperSession | undefined;
  /** The routing engine's stats endpoint: one port and secret, kept until applying fails (the port may have been taken). */
  let stats: StatsEndpoint | undefined;
  const statsEndpoint = async () =>
    (stats ??= { port: await freePort(), secret: randomBytes(24).toString('base64url') });
  let traffic: ReturnType<typeof createTrafficMonitor> | undefined;

  /** The helper session, opened on first use. If it ends unexpectedly, the helper has removed our routes. */
  async function getHelper(): Promise<HelperSession> {
    if (helper) {
      return helper;
    }
    const token = await readHelperToken(deps.dataDir);
    if (!token) {
      throw new Error('Install the network helper first (top of the window).');
    }
    const session = await openHelperSession({ port: HELPER_PORT, token });
    helper = session;
    void session.closed.then(() =>
      deps.exclusive(async () => {
        if (helper !== session) {
          return;
        } // closed on purpose
        helper = undefined;
        traffic?.stop();
        await deps.onHelperLost();
      }),
    );
    return session;
  }

  /**
   * Hands the routes to the network helper (which removes everything when there's no plan, i.e. nothing
   * is connected), along with the stats endpoint the traffic monitor reads.
   */
  async function apply(plan: RoutePlan | undefined): Promise<void> {
    if (!plan) {
      await helper?.apply(NO_ROUTES);
      traffic?.stop();
      return;
    }
    const { tunnels, domains, blockIpv6 } = plan;
    const endpoint = await statsEndpoint();
    try {
      await (await getHelper()).apply({ tunnels, domains, blockIpv6, stats: endpoint });
    } catch (error) {
      // The port may have been taken meanwhile; the next attempt picks another.
      stats = undefined;
      traffic?.stop();
      traffic = undefined;
      throw error;
    }
    traffic ??= createTrafficMonitor({
      endpoint,
      connectedVpns: deps.connectedVpns,
      onUpdate: deps.onTraffic,
    });
    traffic.start();
  }

  /** Removes every route and closes the helper session (the next use opens a new one). */
  async function close() {
    traffic?.stop();
    const session = helper;
    helper = undefined;
    if (session) {
      await session.apply(NO_ROUTES).catch(() => undefined);
      session.close();
    }
  }

  return { getHelper, apply, close };
}
