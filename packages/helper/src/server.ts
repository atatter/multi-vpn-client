import {
  appProofMessage,
  HELPER_VERSION,
  helperProofMessage,
  MAX_HELPER_LINE,
  NO_ROUTES,
  parseHelperLine,
  type HelperResponse,
  type HostRoutes,
} from '@repo/core';
import { proofMatches, signProof } from '@repo/core/helper-crypto';
import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

/** What the helper does with a validated routing state. Applying `NO_ROUTES` removes everything. */
export interface HostBackend {
  apply(routes: HostRoutes): Promise<void>;
}

/** Where a connection is in the handshake (see core/helper-protocol). */
type Phase =
  | { name: 'new' }
  | { name: 'challenged'; challenge: string }
  | { name: 'authenticated' };

/**
 * Loopback server speaking the helper protocol (see core/helper-protocol).
 *
 * - `status` works without authentication and reveals only the version.
 * - `hello` → `auth` is a mutual challenge-response keyed by `key`; success
 *   makes the connection the active session. Taking over from an older
 *   session ends it and removes its routes, so a new session starts clean.
 * - Only the active session may `apply`. When it ends — the app quit or
 *   crashed, or an apply failed or was refused — all routes and DNS entries are removed.
 */
export function createHelperServer({
  key,
  backend,
  log,
}: {
  key: Buffer;
  backend: HostBackend;
  log: (line: string) => void;
}) {
  const sign = (message: string) => signProof(key, message);

  let active: Socket | undefined;
  // Backend changes run one at a time, across all connections.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = (operation: () => Promise<void>) => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
  /** The active session is over: everything it applied is removed. */
  const endActive = (reason: string) => {
    active = undefined;
    log(`${reason}; removing routes`);
    void exclusive(() => backend.apply(NO_ROUTES)).catch((error: unknown) =>
      log(`teardown failed: ${String(error)}`),
    );
  };

  const server: Server = createServer((socket) => {
    let phase: Phase = { name: 'new' };
    let buffer = '';
    let pending: Promise<void> = Promise.resolve();
    const reply = (response: HelperResponse) => {
      if (socket.writable) {
        socket.write(`${JSON.stringify(response)}\n`);
      }
    };
    const refuse = () => {
      reply({ ok: false, error: 'Unauthorized' });
      socket.destroy();
    };
    // A failed apply can leave part of it in place (e.g. DNS set, sing-box not started), and a refused one leaves
    // the previous routes pointing at VPNs the app may have stopped. Either way the session ends: everything is
    // removed, and the app drops its VPNs instead of showing them on.
    const endAfterFailedApply = () => {
      if (active === socket) {
        endActive('ending the session');
      }
      socket.end();
    };

    async function handle(line: string) {
      const parsed = parseHelperLine(line);
      if (!parsed.ok) {
        reply(parsed);
        if (phase.name === 'authenticated') {
          endAfterFailedApply();
        }
        return;
      }
      const request = parsed.request;

      switch (request.command) {
        case 'status':
          return reply({ ok: true, version: HELPER_VERSION });

        case 'hello': {
          if (phase.name !== 'new') {
            return refuse();
          }
          const challenge = randomBytes(32).toString('base64url');
          phase = { name: 'challenged', challenge };
          return reply({
            ok: true,
            version: HELPER_VERSION,
            challenge,
            proof: sign(helperProofMessage(request.nonce)),
          });
        }

        case 'auth': {
          if (
            phase.name !== 'challenged' ||
            !proofMatches(request.proof, sign(appProofMessage(phase.challenge)))
          ) {
            return refuse();
          }
          phase = { name: 'authenticated' };
          if (active && active !== socket) {
            active.destroy();
            void exclusive(() => backend.apply(NO_ROUTES)).catch((error: unknown) =>
              log(`teardown failed: ${String(error)}`),
            );
          }
          active = socket;
          return reply({ ok: true, version: HELPER_VERSION });
        }

        case 'apply': {
          // A replaced session may still have requests queued; they must not touch the new session's state.
          if (phase.name !== 'authenticated' || active !== socket) {
            return refuse();
          }
          try {
            await exclusive(() => backend.apply(request.routes));
            reply({ ok: true, version: HELPER_VERSION });
          } catch (error) {
            log(`apply failed: ${String(error)}`);
            reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
            endAfterFailedApply();
          }
        }
      }
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        pending = pending.then(() => handle(line));
      }
      if (buffer.length > MAX_HELPER_LINE) {
        socket.destroy();
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      if (active === socket) {
        endActive('session ended');
      }
    });
  });

  return {
    listen: (port: number) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      }),
    /** Ends the active session (e.g. the engine crashed), which tears everything down. */
    endSession: () => active?.destroy(),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
