import { isPinnable, routeFor, type Config, type ConnectionState, type ConnectionStatus, type ConnectResult, type ServerRoutes, type TrafficSnapshot, type VpnKind } from '@repo/core';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { removeStaleContainers } from '../container/cleanup.ts';
import { ensureVpnImage, runInImage } from '../container/images.ts';
import { CancelledError, UntrustedCertificateError } from '../container/output.ts';
import { CARD_NAME } from '@repo/vpn-sdk/engine';
import { startVpnContainer, type VpnSession } from '../container/start.ts';
import { createDocker, findDocker, type Docker } from '../docker.ts';
import { helperState, installHelper, uninstallHelper } from '../helper-install/index.ts';
import { ensureSingBox } from '../singbox-binary.ts';
import type { CardBridge } from '../smart-card.ts';
import { createHost } from './host.ts';
import { noRoutesWarning, planRoutes, sameRoutes } from './host-routes.ts';
import { actionOf, launchFor } from './launch-for.ts';
import { createQueue } from './queue.ts';
import { createStatusBoard } from './statuses.ts';
import { untilAborted } from './until-aborted.ts';
import { createUserWaits } from './user-waits.ts';

/**
 * Owns live connections: one container per connected VPN, plus a session with
 * the installed network helper, which routes the connected VPNs' CIDRs into
 * their containers. Routes are recomputed whenever the set of connected VPNs
 * or the saved routes change. Every change to that state, including reacting
 * to a container or the helper going away, runs one at a time (`exclusive`).
 * A connect only takes its turn for the quick parts: building the image, finding
 * the card, starting the container and waiting for the user happen outside the
 * queue, so other VPNs aren't held up meanwhile.
 */

interface Dependencies {
  dataDir: string;
  /** The helper executable to install for this OS/architecture. */
  helperBinary: string;
  /** The saved config (connections always use saved settings, never unsaved edits). */
  loadConfig(): Promise<Config>;
  readSecret(vpnId: string, key: string): Promise<string | undefined>;
  onChange(statuses: Record<string, ConnectionStatus>): void;
  /** Opens a VPN's browser sign-in page (always https) in the user's browser. */
  openUrl(url: string): void;
  /** The card bridge executable for this OS/architecture (packages/card-bridge), for smart card sign-in. */
  cardBridgeBinary: string;
  /** Saves what a VPN's server sent on connect (the config's `serverRoutes`), so "official" knows what to route. */
  saveServerRoutes(vpnId: string, routes: ServerRoutes): Promise<void>;
  /** Live traffic, about once a second while anything is connected. */
  onTraffic(snapshot: TrafficSnapshot): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createConnectionManager(deps: Dependencies) {
  const statuses = createStatusBoard(deps.onChange);
  const waits = createUserWaits({ statuses, openUrl: deps.openUrl, cardBridgeBinary: deps.cardBridgeBinary });
  const sessions = new Map<string, VpnSession>();
  /** The certificate pin each VPN's gateway last presented without being trusted; only this one can be trusted. */
  const presentedPins = new Map<string, string>();
  /** Connects in flight, so a disconnect (or quitting) can stop one midway; `done` settles once it has unwound. */
  const connecting = new Map<string, { abort: AbortController; done: Promise<ConnectResult> }>();
  let docker: Docker | undefined;
  /** Serializes everything that changes connections or routes. */
  const exclusive = createQueue();
  const host = createHost({
    dataDir: deps.dataDir,
    exclusive,
    connectedVpns: () => [...sessions.keys()],
    onTraffic: deps.onTraffic,
    onHelperLost: async () => {
      // A snapshot: drop() removes sessions while this awaits.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const vpnId of [...sessions.keys()]) {
        await drop(vpnId, { state: 'error', message: "The network helper stopped or couldn't apply the routes, so it removed them. Connect again." });
      }
    },
  });

  /** Stops a VPN's container (if connected) and records its new state. Call `syncHost` afterwards. */
  async function drop(vpnId: string, state: ConnectionState) {
    const session = sessions.get(vpnId);
    sessions.delete(vpnId);
    await session?.stop();
    statuses.set(vpnId, state);
  }

  /** Docker, checked to be running. The first successful call also removes containers left by a crash. */
  async function getDocker(): Promise<Docker> {
    if (docker) {
      await docker.assertRunning();
      return docker;
    }
    const candidate = createDocker(await findDocker());
    await candidate.assertRunning();
    await removeStaleContainers(candidate);
    docker = candidate;
    return docker;
  }

  /**
   * Recomputes routes for the connected VPNs, hands them to the network helper, and refreshes each connected VPN's
   * "nothing is sent through it" warning: it depends on the others too, whose servers stay off every tunnel.
   * Returns the warning lookup, for a VPN that's about to show as connected.
   */
  const syncHost = async () => {
    const config = await deps.loadConfig();
    const plan = await planRoutes(config, sessions);
    await host.apply(plan);
    const warningOf = (vpnId: string) => noRoutesWarning(config.vpns.find((candidate) => candidate.id === vpnId), config.routes, plan?.compiled);
    for (const vpnId of sessions.keys()) {
      const current = statuses.get(vpnId);
      const warning = warningOf(vpnId);
      if (current?.state === 'connected' && current.warning !== warning) statuses.set(vpnId, { ...current, warning });
    }
    return warningOf;
  };

  /** Connects, unless this VPN is connected or connecting already (then it's that connect's result). */
  function startConnect(vpnId: string, password: string | undefined): Promise<ConnectResult> {
    if (sessions.has(vpnId)) return Promise.resolve({ ok: true });
    const pending = connecting.get(vpnId);
    if (pending) return pending.done;
    const abort = new AbortController();
    const done = connect(vpnId, password, abort.signal).finally(() => connecting.delete(vpnId));
    connecting.set(vpnId, { abort, done });
    return done;
  }

  /** Stops a connect in flight, if any, and waits until it has unwound (its container removed). */
  async function stopConnect(vpnId: string) {
    const pending = connecting.get(vpnId);
    pending?.abort.abort(new CancelledError());
    await pending?.done;
  }
  const stopConnects = () => Promise.all([...connecting.keys()].map(stopConnect));

  /** Use through startConnect. Aborting `signal` stops it wherever it is (CancelledError: ends disconnected). */
  async function connect(vpnId: string, password: string | undefined, signal: AbortSignal): Promise<ConnectResult> {
    statuses.begin(vpnId, { state: 'connecting', step: 'Preparing…' });
    const onLog = statuses.logger(vpnId);
    /** Whether a certificate was already trusted for this VPN, i.e. the gateway's certificate changed. */
    let hadPin = false;
    let cardBridge: CardBridge | undefined;
    let session: VpnSession | undefined;
    /** Set if the container stops after starting; before it's routed to, that fails the connect. */
    let dropped: string | undefined;
    // A wait for the user ends at once; the container start notices the signal itself.
    signal.addEventListener('abort', () => waits.cancel(vpnId), { once: true });
    try {
      // Quick, but shares the helper session, Docker and secrets with everything else: in the queue.
      const prepared = await exclusive(async () => {
        signal.throwIfAborted();
        const config = await deps.loadConfig();
        const vpn = config.vpns.find((candidate) => candidate.id === vpnId);
        if (!vpn) throw new Error('Save this VPN before connecting.');
        hadPin = isPinnable(vpn) && vpn.serverCertPin !== '';
        await host.getHelper(); // fails early, with a precise reason, if the helper isn't usable
        const launch = await launchFor(vpn, password, deps.readSecret);
        if (launch === 'needs-password') return launch;
        statuses.set(vpnId, { state: 'connecting', step: 'Starting the VPN container…' });
        return { vpn, launch, engine: await getDocker() };
      });
      if (prepared === 'needs-password') {
        statuses.set(vpnId, { state: 'disconnected' });
        return { ok: false, needsPassword: true };
      }

      // Minutes, some of them the user's (image build, card, PIN, browser): outside the queue.
      const { vpn, launch, engine } = prepared;
      signal.throwIfAborted();
      await untilAborted(ensureVpnImage(engine, launch.image, onLog), signal);

      const signingIn = launch.signInStep ?? 'Connecting to the VPN server…';
      if (launch.smartCard) {
        statuses.set(vpnId, { state: 'connecting', step: `Looking for your ${CARD_NAME[launch.smartCard]}…` });
        cardBridge = await waits.findCard(vpnId, launch.smartCard);
        onLog(`Using the card in ${cardBridge.reader}.`);
      }
      statuses.set(vpnId, { state: 'connecting', step: signingIn });
      session = await startVpnContainer(engine, {
        vpnId,
        launch,
        dnsServers: vpn.dns.servers,
        onLog,
        onPrompt: (prompt) => waits.ask(vpnId, prompt, signingIn),
        onBrowserSignIn: (signIn) => waits.signInWithBrowser(vpnId, signIn),
        cardBridge,
        signal,
        onExit: (lastLines) => {
          const message = `The VPN connection dropped: ${lastLines.at(-1) ?? ''}`;
          dropped = message;
          void exclusive(async () => {
            if (!session || sessions.get(vpnId) !== session) return; // not routed to yet: the connect fails on `dropped`
            await drop(vpnId, { state: 'error', message });
            await syncHost();
          }).catch((error: unknown) => onLog(messageOf(error)));
        },
      });

      // Routing to the new tunnel changes shared state: in the queue again, briefly.
      const started = session;
      await exclusive(async () => {
        signal.throwIfAborted();
        if (dropped) throw new Error(dropped);
        sessions.set(vpnId, started);
        statuses.set(vpnId, { state: 'connecting', step: 'Routing traffic…' });
        // What the server sent decides what "same as the official app" routes, from now on and in the UI.
        // Best effort: failing to save it mustn't drop a working connection.
        if (started.pushedRoutes && !sameRoutes(vpn.serverRoutes, started.pushedRoutes)) {
          await deps.saveServerRoutes(vpnId, started.pushedRoutes).catch((error: unknown) => onLog(`Couldn't save what the server sends: ${messageOf(error)}`));
        }
        const warningOf = await syncHost();
        statuses.set(vpnId, { state: 'connected', since: Date.now(), warning: warningOf(vpnId) });
      });
      return { ok: true };
    } catch (error) {
      return failConnect(vpnId, error, { hadPin, cardBridge, session });
    }
  }

  /** Cleans up after a connect that failed with `error` (whatever it got to: card, container) and reports why. */
  async function failConnect(
    vpnId: string,
    error: unknown,
    { hadPin, cardBridge, session }: { hadPin: boolean; cardBridge: CardBridge | undefined; session: VpnSession | undefined },
  ): Promise<ConnectResult> {
    // A prompt or sign-in the client left open (it stopped, or timed out) mustn't outlive the attempt.
    waits.cancel(vpnId);
    cardBridge?.stop();
    // A container that started but was never routed to (cancelled just before) goes too.
    if (session && sessions.get(vpnId) !== session) await session.stop();
    if (error instanceof CancelledError) {
      statuses.set(vpnId, { state: 'disconnected' });
      return { ok: false, error: error.message };
    }
    const message = messageOf(error);
    const onLog = statuses.logger(vpnId);
    onLog(message);
    if (error instanceof UntrustedCertificateError) {
      presentedPins.set(vpnId, error.pin);
      statuses.set(vpnId, { state: 'disconnected' });
      return { ok: false, untrustedCertificate: { pin: error.pin, server: error.server, changed: hadPin } };
    }
    await exclusive(async () => {
      if (!session || sessions.get(vpnId) !== session) return statuses.set(vpnId, { state: 'error', message });
      await drop(vpnId, { state: 'error', message });
      await syncHost().catch((cleanupError: unknown) => onLog(messageOf(cleanupError)));
    });
    return { ok: false, error: message };
  }

  async function disconnect(vpnId: string) {
    await drop(vpnId, { state: 'disconnected' });
    await syncHost().catch((error: unknown) => statuses.logger(vpnId)(messageOf(error)));
  }

  async function shutdown() {
    // A snapshot: drop() removes sessions while this awaits.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const vpnId of [...sessions.keys()]) await drop(vpnId, { state: 'disconnected' });
    await host.close();
  }

  return {
    connect: startConnect,

    /** Answers the prompt this VPN's client is waiting on (e.g. the SMS code); null cancels the connect. */
    answer: waits.answer,

    /** Opens this VPN's browser sign-in page again (e.g. after the tab was closed). */
    reopenSignIn: waits.reopenSignIn,

    /** The pin of the certificate this VPN's gateway presented on the last failed connect, if any. */
    presentedPin: (vpnId: string) => presentedPins.get(vpnId),
    disconnect: async (vpnId: string) => {
      const pending = connecting.get(vpnId);
      if (pending) {
        pending.abort.abort(new CancelledError());
        // Stopped before it connected: nothing left to drop (and a queued drop could land on a newer attempt).
        if (!(await pending.done).ok) return;
      }
      await exclusive(() => disconnect(vpnId));
    },

    /** Re-applies routes after the saved config changed. */
    refresh: () =>
      exclusive(async () => {
        if (sessions.size === 0) return;
        try {
          await syncHost();
        } catch (error) {
          for (const vpnId of sessions.keys()) statuses.logger(vpnId)(`Updating routes failed: ${messageOf(error)}`);
        }
      }),

    statuses: statuses.all,

    /** Which connected VPN carries traffic to a site (see core's parseSite) right now, or undefined for the normal connection. */
    routeFor: async ({ site, isAddress }: { site: string; isAddress: boolean }): Promise<string | undefined> => {
      // Only reads state, so it stays out of the queue: a slow lookup mustn't hold up connects.
      const plan = await planRoutes(await deps.loadConfig(), sessions);
      if (!plan) return undefined;
      // A routed name resolves to a placeholder address, so names are matched first, as the router does.
      const addresses = isAddress ? [site] : await lookup(site, { all: true, family: 4 }).then((found) => found.map((entry) => entry.address), () => []);
      return routeFor(plan.compiled, { ...(isAddress ? {} : { domain: site }), addresses });
    },

    /** Runs one of a kind's actions for its form (e.g. Check Point's login types). The action parses its input; the form parses the output. */
    runAction: async (kind: VpnKind, name: string, input: unknown) => {
      const run = actionOf(kind, name);
      if (!run) throw new Error('This VPN type has no such action.');
      // Docker is reached only once the action has parsed its input, so a malformed call does nothing on the host.
      // The build and run stay outside the queue, like a connect's build; a failure says why itself.
      return run(input, { runInImage: async (image, oneOff) => runInImage(await exclusive(getDocker), image, oneOff) });
    },

    /** Removes VPN containers left by a crash. Best effort: call at app start; does nothing if Docker isn't available. */
    removeLeftovers: () =>
      exclusive(async () => {
        await getDocker().catch(() => undefined);
      }),

    /** Disconnects everything; call before the app quits. */
    shutdown: async () => {
      await stopConnects();
      await exclusive(shutdown);
    },

    helperState: () => helperState(deps.dataDir),

    /** Installs (or updates) the helper: one admin prompt. Downloads sing-box first if needed. */
    installHelper: async () => {
      await stopConnects();
      await exclusive(async () => {
        await shutdown();
        const singBox = await ensureSingBox(join(deps.dataDir, 'bin'));
        await installHelper({ dataDir: deps.dataDir, helperBinary: deps.helperBinary, singBox });
      });
    },

    uninstallHelper: async () => {
      await stopConnects();
      await exclusive(async () => {
        await shutdown();
        await uninstallHelper(deps.dataDir);
      });
    },
  };
}

export type ConnectionManager = ReturnType<typeof createConnectionManager>;
