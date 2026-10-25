import { newVpn, type Config } from '@repo/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { startVpnContainer } from '../container/start.ts';
import { createConnectionManager } from './connection-manager.ts';

// The manager against fakes for Docker, the helper and the container: what's tested is who waits for whom.
type StartOptions = Parameters<typeof startVpnContainer>[1];
/** How each VPN's (fake) container start behaves, by VPN id; unlisted ones connect at once. */
const starts = new Map<string, (options: StartOptions) => Promise<void>>();
/** What the (fake) image build waits on; resolved by default. */
let build: Promise<void> = Promise.resolve();
/** What each VPN's (fake) server sends, by VPN id; unlisted ones keep no record. */
const pushed = new Map<string, { all: boolean; cidrs: string[] }>();
/** The server each VPN's (fake) client connected to, by VPN id; unlisted ones don't say. */
const endpoints = new Map<string, string>();
/** Learned routes the manager asked to save. */
const saved: [string, { all: boolean; cidrs: string[] }][] = [];

/** How often the manager went looking for Docker; finding it removes leftover containers. */
const dockerLookups = vi.hoisted(() => ({ count: 0 }));

vi.mock('../docker.ts', () => ({
  findDocker: async () => {
    dockerLookups.count++;
    return '/fake/docker';
  },
  createDocker: (bin: string) => ({
    bin,
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    runChecked: async () => '',
    assertRunning: async () => undefined,
  }),
}));
vi.mock('../helper-install/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../helper-install/index.ts')>()),
  readHelperToken: async () => 'token',
}));
/** The (fake) helper: while `failing`, applying fails and ends the session, as the real helper does. */
const helper = vi.hoisted(() => ({ failing: false }));
vi.mock('../helper-client.ts', () => ({
  openHelperSession: async () => {
    let end: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (end = resolve));
    const apply = async () => {
      if (!helper.failing) {
        return;
      }

      end();
      throw new Error('resolvectl failed');
    };

    return { apply, close: () => undefined, closed };
  },
}));
vi.mock('@repo/core/host', () => ({ hostReserved: async () => ({ reserved: [] }) }));
vi.mock('../container/images.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../container/images.ts')>()),
  ensureVpnImage: () => build,
}));
vi.mock('../container/cleanup.ts', () => ({ removeStaleContainers: async () => undefined }));
vi.mock('../container/start.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../container/start.ts')>()),
  startVpnContainer: async (_docker: unknown, options: StartOptions) => {
    await starts.get(options.vpnId)?.(options);
    return {
      port: 1080,
      username: 'u',
      password: 'p',
      pushedDns: [],
      pushedRoutes: pushed.get(options.vpnId),
      endpoint: endpoints.get(options.vpnId),
      stop: async () => undefined,
    };
  },
}));

const checkpoint = (id: string) => ({
  ...newVpn('checkpoint', { id, name: id }),
  server: 'vpn.example.com',
  loginType: 'vpn_x',
});
const config: Config = {
  version: 1,
  vpns: [checkpoint('a'), checkpoint('b'), checkpoint('dies')],
  routes: [],
  priority: [],
};
let savedConfig = config;

const manager = () =>
  createConnectionManager({
    dataDir: '/tmp/mvpn-test',
    helperBinary: '',
    cardBridgeBinary: '',
    loadConfig: async () => savedConfig,
    readSecret: async () => undefined,
    onChange: () => undefined,
    openUrl: () => undefined,
    saveServerRoutes: async (vpnId, routes) => void saved.push([vpnId, routes]),
    onTraffic: () => undefined,
  });

describe('connection manager', () => {
  beforeEach(() => {
    starts.clear();
    pushed.clear();
    endpoints.clear();
    saved.length = 0;
    savedConfig = config;
    build = Promise.resolve();
    helper.failing = false;
    // A asks for a one-time code; B connects right away.
    starts.set(
      'a',
      async ({ onPrompt }) => void (await onPrompt('Please enter your one-time code')),
    );
  });

  it('connects and disconnects other VPNs while one waits for the user', async () => {
    const connections = manager();
    const a = connections.connect('a', undefined);
    await vi.waitFor(() => expect(connections.statuses().a?.state).toBe('awaiting-code'));

    await expect(connections.connect('b', undefined)).resolves.toEqual({ ok: true });
    expect(connections.statuses().b?.state).toBe('connected');
    await connections.refresh();
    await connections.disconnect('b');
    expect(connections.statuses().b?.state).toBe('disconnected');
    expect(connections.statuses().a?.state).toBe('awaiting-code');

    connections.answer('a', '1234');
    await expect(a).resolves.toEqual({ ok: true });
    expect(connections.statuses().a?.state).toBe('connected');
  });

  it('stops a connect midway on disconnect, whether it waits for the user or for the container', async () => {
    const connections = manager();
    const a = connections.connect('a', undefined);
    await vi.waitFor(() => expect(connections.statuses().a?.state).toBe('awaiting-code'));
    await connections.disconnect('a');
    await expect(a).resolves.toEqual({ ok: false, error: 'Cancelled.' });
    expect(connections.statuses().a?.state).toBe('disconnected');

    starts.set(
      'b',
      ({ signal }) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    const b = connections.connect('b', undefined);
    await vi.waitFor(() =>
      expect(connections.statuses().b).toMatchObject({
        state: 'connecting',
        step: expect.stringContaining('Signing in'),
      }),
    );
    await connections.shutdown();
    await expect(b).resolves.toEqual({ ok: false, error: 'Cancelled.' });
    expect(connections.statuses().b?.state).toBe('disconnected');
  });

  it('stops a connect on disconnect while its image is still building, and a later build failure goes nowhere', async () => {
    let failBuild: (error: Error) => void = () => undefined;
    build = new Promise((_, reject) => (failBuild = reject));
    const connections = manager();
    const b = connections.connect('b', undefined);
    await vi.waitFor(() =>
      expect(connections.statuses().b).toMatchObject({
        state: 'connecting',
        step: 'Starting the VPN container…',
      }),
    );
    await connections.disconnect('b');
    await expect(b).resolves.toEqual({ ok: false, error: 'Cancelled.' });
    failBuild(new Error('Building the VPN container image failed')); // must not surface as an unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('lets only one VPN wait for a browser sign-in on the token port', async () => {
    const signIn = async ({ onBrowserSignIn }: StartOptions) =>
      void (await onBrowserSignIn({
        signInUrl: 'https://vpn.example.com/saml',
        tokenPort: 47_799,
      }));
    starts.set('a', signIn);
    starts.set('b', signIn);
    const connections = manager();
    const a = connections.connect('a', undefined);
    await vi.waitFor(() => expect(connections.statuses().a?.state).toBe('awaiting-browser'));
    await expect(connections.connect('b', undefined)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Another VPN is waiting'),
    });
    await connections.disconnect('a');
    await expect(a).resolves.toEqual({ ok: false, error: 'Cancelled.' });
  });

  it("doesn't report a container that stopped before it was routed to as connected", async () => {
    starts.set('dies', async ({ onExit }) => onExit(['Tunnel closed']));
    const connections = manager();
    await expect(connections.connect('dies', undefined)).resolves.toEqual({
      ok: false,
      error: 'The VPN connection dropped: Tunnel closed',
    });
    expect(connections.statuses().dies?.state).toBe('error');
  });

  it("masks every prompt except usernames and one-time codes, whatever the gateway's language", async () => {
    const connections = manager();
    const secretFor = async (prompt: string) => {
      starts.set('b', async ({ onPrompt }) => void (await onPrompt(prompt)));
      const b = connections.connect('b', undefined);
      await vi.waitFor(() => expect(connections.statuses().b?.state).toBe('awaiting-code'));
      const status = connections.statuses().b;
      connections.answer('b', 'x');
      await b;
      await connections.disconnect('b');

      return status?.state === 'awaiting-code' && status.secret;
    };
    expect(await secretFor('Password')).toBe(true);
    expect(await secretFor('Salasõna')).toBe(true);
    expect(await secretFor('Enter your passcode')).toBe(true);
    expect(await secretFor('Please enter your one-time code')).toBe(false);
    expect(await secretFor('Username')).toBe(false);
  });

  it('keeps every connected VPN\'s "nothing is sent through it" warning current as others come and go', async () => {
    // B's server is the only address A routes, and a VPN's server always stays off the tunnels.
    savedConfig = {
      ...config,
      routes: [
        {
          id: 'r1',
          vpnId: 'a',
          kind: 'cidr',
          cidr: '198.51.100.7/32',
          enabled: true,
          note: '',
          pinned: false,
        },
      ],
    };
    endpoints.set('b', '198.51.100.7');
    starts.delete('a');
    const connections = manager();
    await connections.connect('a', undefined);
    expect(connections.statuses().a).toMatchObject({ state: 'connected', warning: undefined });
    await connections.connect('b', undefined);
    expect(connections.statuses().a).toMatchObject({
      state: 'connected',
      warning: expect.stringContaining('nothing is sent'),
    });
    await connections.disconnect('b');
    expect(connections.statuses().a).toMatchObject({ state: 'connected', warning: undefined });
  });

  it("shows every VPN as dropped when the helper can't apply the routes, since it removed them all", async () => {
    starts.delete('a');
    const connections = manager();
    await connections.connect('b', undefined);
    helper.failing = true;
    await expect(connections.connect('a', undefined)).resolves.toEqual({
      ok: false,
      error: 'resolvectl failed',
    });
    expect(connections.statuses().a).toMatchObject({
      state: 'error',
      message: 'resolvectl failed',
    });
    await vi.waitFor(() =>
      expect(connections.statuses().b).toMatchObject({
        state: 'error',
        message: expect.stringContaining("couldn't apply the routes"),
      }),
    );
  });

  it('shares one connect between repeated requests for the same VPN', async () => {
    const connections = manager();
    const first = connections.connect('a', undefined);
    const second = connections.connect('a', undefined);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(connections.statuses().a?.state).toBe('awaiting-code'));
    connections.answer('a', '1234');
    await expect(first).resolves.toEqual({ ok: true });
  });

  it("saves what a server sent when it changed, so the official app's routes are known from then on", async () => {
    pushed.set('b', { all: false, cidrs: ['10.140.0.0/16'] });
    const connections = manager();
    await expect(connections.connect('b', undefined)).resolves.toEqual({ ok: true });
    expect(saved).toEqual([['b', { all: false, cidrs: ['10.140.0.0/16'] }]]);
  });

  it("refuses an action's malformed input, or an unknown action, before reaching Docker", async () => {
    const connections = manager();
    const before = dockerLookups.count;
    await expect(
      connections.runAction('checkpoint', 'loginTypes', 'vpn.b --mode=connect'),
    ).rejects.toThrow(ZodError);
    await expect(connections.runAction('openvpn', 'loginTypes', 'vpn.b')).rejects.toThrow(
      'This VPN type has no such action.',
    );
    expect(dockerLookups.count).toBe(before);
  });
});
