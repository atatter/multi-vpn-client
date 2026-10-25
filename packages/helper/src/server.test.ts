import {
  appProofMessage,
  HELPER_VERSION,
  helperProofMessage,
  NO_ROUTES,
  type HostRoutes,
  type VpnTunnel,
} from '@repo/core';
import { helperKey, signProof } from '@repo/core/helper-crypto';
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHelperServer } from './server.ts';

const TOKEN = 'app-secret-token';
const KEY = helperKey(TOKEN);
const sign = signProof;
const tunnel: VpnTunnel = {
  vpnId: 'a',
  port: 41_000,
  username: 'u',
  password: 'p',
  cidrs: ['10.20.0.0/16'],
  dns: { servers: [], domains: [] },
};
const routes: HostRoutes = {
  blockIpv6: false,
  tunnels: [tunnel],
  domains: [{ vpnId: 'a', domain: 'argo.lab.example' }],
};

type Reply = { ok: boolean; version?: number; challenge?: string; proof?: string; error?: string };

/** A raw protocol client that sends lines and reads replies in order. */
async function client(port: number) {
  const socket: Socket = connect(port, '127.0.0.1');
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.setEncoding('utf8');
  const replies: Reply[] = [];
  let buffer = '';
  const waiters: (() => void)[] = [];
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buffer.slice(0, newline)) as Reply);
      buffer = buffer.slice(newline + 1);
      waiters.shift()?.();
    }
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const send = async (request: unknown) => {
    const received = new Promise<void>((resolve) => waiters.push(resolve));
    socket.write(`${typeof request === 'string' ? request : JSON.stringify(request)}\n`);
    await Promise.race([received, closed]);
    return replies.at(-1);
  };
  /** Runs the handshake with `key`; returns the helper's hello reply and the auth reply. */
  const authenticate = async (key = KEY) => {
    const nonce = 'client-nonce';
    const hello = await send({ command: 'hello', nonce });
    const auth = await send({
      command: 'auth',
      proof: sign(key, appProofMessage(hello?.challenge ?? '')),
    });
    return { hello, auth, nonce };
  };
  return { socket, closed, send, authenticate };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

let stop: (() => Promise<void>) | undefined;
afterEach(async () => stop?.());

/** A helper over a backend that records what it's given; with `failing`, applying anything but NO_ROUTES throws. */
async function start({ failing = false } = {}) {
  const applied: HostRoutes[] = [];
  const apply = async (state: HostRoutes) => {
    applied.push(state);
    if (failing && state !== NO_ROUTES) {
      throw new Error('resolvectl failed');
    }
  };
  const server = createHelperServer({ key: KEY, backend: { apply }, log: () => undefined });
  const port = await server.listen(0);
  stop = server.close;
  return { port, applied, server };
}

describe('helper server', () => {
  it('answers status without authentication', async () => {
    const { port } = await start();
    const c = await client(port);
    expect(await c.send({ command: 'status' })).toEqual({ ok: true, version: HELPER_VERSION });
    c.socket.destroy();
  });

  it('proves it holds the key before the app sends anything secret', async () => {
    const { port } = await start();
    const c = await client(port);
    const { hello, nonce } = await c.authenticate();
    expect(hello?.proof).toBe(sign(KEY, helperProofMessage(nonce)));
    c.socket.destroy();
  });

  it('refuses apply before the handshake, and a wrong key, and disconnects', async () => {
    const { port, applied } = await start();
    const anonymous = await client(port);
    expect(await anonymous.send({ command: 'apply', routes })).toEqual({
      ok: false,
      error: 'Unauthorized',
    });
    await anonymous.closed;

    const wrong = await client(port);
    const { auth } = await wrong.authenticate(helperKey('other'));
    expect(auth).toEqual({ ok: false, error: 'Unauthorized' });
    await wrong.closed;

    const skipped = await client(port);
    expect(await skipped.send({ command: 'auth', proof: 'a'.repeat(64) })).toEqual({
      ok: false,
      error: 'Unauthorized',
    });
    await skipped.closed;
    expect(applied).toEqual([]);
  });

  it('applies validated tunnels for an authenticated session and tears down when it ends', async () => {
    const { port, applied } = await start();
    const c = await client(port);
    expect((await c.authenticate()).auth).toEqual({ ok: true, version: HELPER_VERSION });
    expect(await c.send({ command: 'apply', routes })).toEqual({
      ok: true,
      version: HELPER_VERSION,
    });
    c.socket.destroy();
    await settle();
    expect(applied).toEqual([routes, NO_ROUTES]);
  });

  it('ends the session when applying fails, removing whatever got applied', async () => {
    const { port, applied } = await start({ failing: true });
    const c = await client(port);
    await c.authenticate();
    expect(await c.send({ command: 'apply', routes })).toEqual({
      ok: false,
      error: 'resolvectl failed',
    });
    await c.closed;
    await settle();
    expect(applied).toEqual([routes, NO_ROUTES]);
  });

  it('rejects invalid input before the handshake without ending the connection', async () => {
    const { port, applied } = await start();
    const c = await client(port);
    expect(await c.send('GET / HTTP/1.1')).toEqual({ ok: false, error: 'Malformed request' });
    expect(await c.send({ command: 'status' })).toEqual({ ok: true, version: HELPER_VERSION });
    expect(applied).toEqual([]);
    c.socket.destroy();
  });

  it('ends the session when it refuses an apply, removing the routes applied before', async () => {
    const { port, applied } = await start();
    const c = await client(port);
    await c.authenticate();
    await c.send({ command: 'apply', routes });
    expect(
      await c.send({
        command: 'apply',
        routes: {
          tunnels: [{ ...tunnel, cidrs: ['10.20.1.0/16'] }],
          domains: [],
          blockIpv6: false,
        },
      }),
    ).toMatchObject({ ok: false });
    await c.closed;
    await settle();
    expect(applied).toEqual([routes, NO_ROUTES]);
  });

  it("lets a newer session take over, clearing the old session's routes first", async () => {
    const { port, applied } = await start();
    const first = await client(port);
    await first.authenticate();
    await first.send({ command: 'apply', routes });
    const second = await client(port);
    await second.authenticate();
    await first.closed; // replaced
    await settle();
    expect(applied).toEqual([routes, NO_ROUTES]);
    second.socket.destroy();
    await settle();
    expect(applied).toEqual([routes, NO_ROUTES, NO_ROUTES]);
  });

  it('ending the session from the helper side (engine crash) tears down', async () => {
    const { port, applied, server } = await start();
    const c = await client(port);
    await c.authenticate();
    server.endSession();
    await c.closed;
    await settle();
    expect(applied).toEqual([NO_ROUTES]);
  });
});
