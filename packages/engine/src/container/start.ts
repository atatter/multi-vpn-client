import {
  CONTAINER_NETWORKS,
  CONTAINER_SOCKS_PORT,
  containerProxyConfig,
  isIpv4,
  MAX_DNS_SERVERS,
  type ServerRoutes,
} from '@repo/core';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Docker } from '../docker.ts';
import type { CardBridge } from '../smart-card.ts';
import { parseCidr, rangesToCidrs } from '@repo/vpn-sdk/cidr';
import { NONCE_FILE } from '@repo/vpn-sdk/container';
import type { BrowserSignIn, VpnLaunch } from '@repo/vpn-sdk/engine';
import { parsePushedRoutes } from './pushed-routes.ts';
import { waitForTunnel } from './wait-for-tunnel.ts';

/**
 * One container per VPN, running its kind's VPN client plus a SOCKS server (sing-box)
 * that exits through the tunnel. The container's network namespace holds the VPN's
 * routes and DNS, so VPNs can't interfere with each other or the host. Each kind's
 * launcher (@repo/vpns) supplies its client's image, arguments, files and log reading.
 */

/** Every container we create carries this label, so leftovers from a crash can be found and removed. */
export const CONTAINER_LABEL = 'dev.multi-vpn-client=1';

export const containerName = (vpnId: string) => `mvpn-${vpnId}`;

/**
 * Resolvers for a container whose VPN has no DNS configured. Never Docker's own
 * resolver: Docker Desktop resolves through the host, where routed domains get
 * placeholder IPs, so the container would connect back to itself.
 */
const FALLBACK_DNS = ['1.1.1.1', '9.9.9.9'];

/** The resolvers a container starts with: the VPN's configured servers, else public ones (the VPN's pushed servers replace them once connected). */
const resolversFor = (configured: readonly string[]) =>
  configured.length > 0 ? configured : FALLBACK_DNS;

/** `docker run` DNS flags for one-off containers; a VPN's container gets `resolversFor` as a file instead (see ENTRY). */
export const dnsFlags = (configured: readonly string[]) =>
  resolversFor(configured).flatMap((server) => ['--dns', server]);

/** At most this many VPN networks at once (the helper takes at most 64 tunnels). */
const NETWORK_SLOTS = 64;

/**
 * Creates the VPN's own Docker network, named like its container. On a shared one, a container (which has
 * NET_ADMIN) could take another's address and receive that VPN's traffic and proxy password. Each gets a /28
 * from CONTAINER_NETWORKS; Docker refuses one another network holds, and the next is tried.
 */
export async function createVpnNetwork(docker: Pick<Docker, 'run'>, name: string): Promise<void> {
  const block = parseCidr(CONTAINER_NETWORKS);
  if (!block.ok) {
    throw new Error(block.error);
  }

  const [first] = block.range;

  for (let slot = 0; slot < NETWORK_SLOTS; slot++) {
    const [subnet = ''] = rangesToCidrs([[first + slot * 16, first + slot * 16 + 15]]);
    const created = await docker.run([
      'network',
      'create',
      '--label',
      CONTAINER_LABEL,
      '--subnet',
      subnet,
      name,
    ]);
    if (created.code === 0) {
      return;
    }
    if (!/overlap/i.test(created.stderr)) {
      throw new Error(`Docker couldn't create the VPN's network: ${created.stderr.trim()}`);
    }
  }

  throw new Error(
    'Docker has no free network left for this VPN. Disconnect another VPN and try again.',
  );
}

export interface VpnSession {
  /** Host port of the container's SOCKS server. */
  port: number;
  username: string;
  password: string;
  /** IPv4 DNS servers the VPN server pushed (capped at the helper's limit). */
  pushedDns: string[];
  /** What the VPN server sent through the tunnel; undefined when the client keeps no record (Check Point). */
  pushedRoutes: ServerRoutes | undefined;
  /** The address the client actually connected to (e.g. the gateway a GlobalProtect portal picked), if it says. */
  endpoint: string | undefined;
  stop(): Promise<void>;
}

export interface StartOptions {
  vpnId: string;
  launch: VpnLaunch;
  /** DNS servers configured for the VPN; when set, the container uses them instead of pushed ones. */
  dnsServers: readonly string[];
  onLog: (line: string) => void;
  /** The client asks the user for something (e.g. an SMS code). Rejects to give up (CancelledError: the user cancelled). */
  onPrompt: (prompt: string) => Promise<string>;
  /** The user has to sign in in a browser; resolves to the token the page hands back. Rejects to give up. */
  onBrowserSignIn: (signIn: BrowserSignIn) => Promise<string>;
  /** For a launch with `smartCard`: the bridge holding the card, attached once the container runs. Stopped with the container. */
  cardBridge?: CardBridge | undefined;
  /** Aborting gives up the start (rejecting with the reason) and removes the container; ignored once connected. */
  signal: AbortSignal;
  onExit: (lastLines: string[]) => void;
}

/**
 * Starts the container and resolves once the client reports the tunnel is up.
 * Secrets go in with `docker cp` (never env vars or bind mounts); the temp copy
 * on the host is deleted right after, and the container is removed if anything
 * fails. `onExit` is called once if the container stops after it connected.
 */
export async function startVpnContainer(
  docker: Docker,
  options: StartOptions,
): Promise<VpnSession> {
  const { launch } = options;
  const name = containerName(options.vpnId);
  const proxy = { username: 'mvpn', password: randomBytes(18).toString('base64url') };
  const nonce = randomBytes(16).toString('hex');
  const remove = async () => {
    await docker.run(['rm', '--force', name]);
    await docker.run(['network', 'rm', name]);
  };

  options.signal.throwIfAborted();
  await remove();
  await createVpnNetwork(docker, name);
  await docker.runChecked([
    'create',
    '--name',
    name,
    '--label',
    CONTAINER_LABEL,
    '--network',
    name,
    '--cap-add',
    'NET_ADMIN',
    '--device',
    '/dev/net/tun',
    '--sysctl',
    'net.ipv6.conf.all.disable_ipv6=0',
    '--publish',
    `127.0.0.1::${CONTAINER_SOCKS_PORT}`,
    ...(launch.createFlags ?? []),
    launch.image.tag,
    ...launch.command,
  ]);

  let logs: ReturnType<typeof spawn> | undefined;
  let stopped = false;

  try {
    options.signal.throwIfAborted();
    const files: Record<string, string> = {
      ...launch.files,
      'proxy.json': JSON.stringify(containerProxyConfig(proxy)),
      [NONCE_FILE]: nonce,
      resolvers: `${resolversFor(options.dnsServers).join('\n')}\n`,
    };

    if (options.dnsServers.length > 0) {
      files['dns-pinned'] = '';
    }

    await copyFiles(docker, name, files);

    // Checked once more before the client starts: a cancelled connect mustn't sign in (e.g. send an MFA push).
    options.signal.throwIfAborted();
    await docker.runChecked(['start', name]);
    const published =
      (await docker.runChecked(['port', name, `${CONTAINER_SOCKS_PORT}/tcp`]))
        .trim()
        .split('\n')[0] ?? '';
    const port = Number(published.slice(published.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Unexpected port mapping "${published}"`);
    }

    // Follow the logs: they tell us when the tunnel is up, and the stream ends when the container stops.
    const follower = spawn(docker.bin, ['logs', '--follow', name], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logs = follower;
    await waitForTunnel({ docker, name, follower, nonce }, options, () => stopped);

    // What the client recorded once connected: pushed DNS servers and routes, and the server it reached.
    const record = (file: string) => docker.run(['exec', name, 'cat', `/run/mvpn/${file}`]);
    const [pushed, routesRecord, endpointRecord] = await Promise.all([
      record('pushed-dns'),
      record('pushed-routes'),
      record('endpoint'),
    ]);
    const pushedDns = (pushed.code === 0 ? pushed.stdout.split(/\s+/) : [])
      .filter(isIpv4)
      .slice(0, MAX_DNS_SERVERS);
    const endpoint = endpointRecord.code === 0 ? endpointRecord.stdout.trim() : '';

    return {
      port,
      ...proxy,
      pushedDns,
      pushedRoutes: routesRecord.code === 0 ? parsePushedRoutes(routesRecord.stdout) : undefined,
      endpoint: isIpv4(endpoint) ? endpoint : undefined,
      async stop() {
        stopped = true;
        follower.kill();
        options.cardBridge?.stop();
        await remove();
      },
    };
  } catch (error) {
    stopped = true;
    logs?.kill();
    options.cardBridge?.stop();
    await remove();
    throw error;
  }
}

/** Copies files into the container's /run/mvpn through a private temp folder, deleted right after. */
async function copyFiles(docker: Docker, name: string, files: Record<string, string>) {
  const staging = await mkdtemp(join(tmpdir(), 'mvpn-'));

  try {
    for (const [file, content] of Object.entries(files)) {
      await writeFile(join(staging, file), content, { mode: 0o600 });
    }

    await docker.runChecked(['cp', `${staging}/.`, `${name}:/run/mvpn`]);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
