import { HELPER_VERSION, NO_ROUTES, type HostRoutes, type VpnTunnel } from '@repo/core';
import { helperKey } from '@repo/core/helper-crypto';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
// Integration: the real client against the real helper server, with a recording backend.
import { createHelperServer } from '../../helper/src/server.ts';
import { helperVersion, openHelperSession } from './helper-client.ts';

const TOKEN = 'app-secret-token';
const tunnel: VpnTunnel = { vpnId: 'a', port: 41000, username: 'u', password: 'p', cidrs: ['10.20.0.0/16'], dns: { servers: [], domains: [] } };
const routes: HostRoutes = { blockIpv6: false, tunnels: [tunnel], domains: [{ vpnId: 'a', domain: 'argo.lab.example' }] };

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

async function helper(token = TOKEN, { failing = false } = {}) {
  const applied: HostRoutes[] = [];
  const server = createHelperServer({
    key: helperKey(token),
    backend: {
      apply: async (state) => {
        applied.push(state);
        if (failing && state !== NO_ROUTES) throw new Error('resolvectl failed');
      },
    },
    log: () => undefined,
  });
  const port = await server.listen(0);
  cleanup = server.close;
  return { port, applied };
}

/** Something else on the port that mimics the protocol but doesn't know the key, and records what it receives. */
async function impostor() {
  const received: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) {
        received.push(line);
        const request = JSON.parse(line) as { command: string };
        const reply =
          request.command === 'status'
            ? { ok: true, version: HELPER_VERSION }
            : request.command === 'hello'
              ? { ok: true, version: HELPER_VERSION, challenge: 'c'.repeat(43), proof: '0'.repeat(64) }
              : { ok: true, version: HELPER_VERSION };
        socket.write(`${JSON.stringify(reply)}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  cleanup = () => new Promise((resolve) => server.close(() => resolve()));
  return { port: typeof address === 'object' && address ? address.port : 0, received };
}

describe('helper client ⇄ helper server', () => {
  it('reads the version without a session', async () => {
    const { port, applied } = await helper();
    expect(await helperVersion(port)).toBe(HELPER_VERSION);
    expect(applied).toEqual([]);
  });

  it('reports an absent helper as undefined', async () => {
    expect(await helperVersion(1)).toBeUndefined();
  });

  it('applies routes in a session; dropping the session removes them', async () => {
    const { port, applied } = await helper();
    const session = await openHelperSession({ port, token: TOKEN });
    await session.apply(routes);
    session.close();
    await session.closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applied).toEqual([routes, NO_ROUTES]);
  });

  it("refuses a helper that can't prove it knows the key", async () => {
    const { port } = await helper('a-different-install');
    await expect(openHelperSession({ port, token: TOKEN })).rejects.toThrow("couldn't prove");
  });

  it('never sends the token, an auth proof, or routes to an impostor', async () => {
    const { port, received } = await impostor();
    await expect(openHelperSession({ port, token: TOKEN })).rejects.toThrow("couldn't prove");
    expect(received.map((line) => (JSON.parse(line) as { command: string }).command)).toEqual(['status', 'hello']);
    expect(received.join('\n')).not.toContain(TOKEN);
  });

  it("ends the session when the helper can't apply the routes, and fails later requests at once", async () => {
    const { port, applied } = await helper(TOKEN, { failing: true });
    const session = await openHelperSession({ port, token: TOKEN });
    await expect(session.apply(routes)).rejects.toThrow('resolvectl failed');
    await session.closed;
    await expect(session.apply(NO_ROUTES)).rejects.toThrow('closed the connection');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applied).toEqual([routes, NO_ROUTES]);
  });

  it('surfaces validation errors from the helper', async () => {
    const { port } = await helper();
    const session = await openHelperSession({ port, token: TOKEN });
    await expect(session.apply({ blockIpv6: false, tunnels: [{ ...tunnel, cidrs: ['10.20.1.0/16'] }], domains: [] })).rejects.toThrow('refused the routes');
    session.close();
  });
});
