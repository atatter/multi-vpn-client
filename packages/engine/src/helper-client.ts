import {
  appProofMessage,
  HelloReply,
  HELPER_VERSION,
  HelperResponse,
  helperProofMessage,
  type HelperRequest,
  type HostRoutes,
} from '@repo/core';
import { helperKey, proofMatches, signProof } from '@repo/core/helper-crypto';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';

/**
 * Client side of the helper protocol (see core/helper-protocol): one JSON
 * line per request, replies in order, every reply schema-checked, and a
 * timeout on everything so a stuck helper can't hang the app.
 */

/** A reply line, schema-checked; undefined if it isn't valid JSON or doesn't match the protocol. */
function parseReply(line: string): HelperResponse | undefined {
  try {
    const parsed = HelperResponse.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const CONNECT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 15_000;

interface LineConnection {
  request(request: HelperRequest): Promise<HelperResponse>;
  close(): void;
  closed: Promise<void>;
}

function openConnection(port: number): Promise<LineConnection> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    const waiting: {
      resolve: (response: HelperResponse) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }[] = [];
    const failAll = (error: Error) => {
      for (const waiter of waiting.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    };
    let buffer = '';
    const closed = new Promise<void>((done) =>
      socket.once('close', () => {
        failAll(new Error('The network helper closed the connection.'));
        done();
      }),
    );
    const connectTimer = setTimeout(() => socket.destroy(new Error('timeout')), CONNECT_TIMEOUT_MS);

    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const reply = parseReply(line);
        const waiter = waiting.shift();
        if (!waiter) continue;
        clearTimeout(waiter.timer);
        if (reply) waiter.resolve(reply);
        else {
          waiter.reject(new Error('The network helper sent an invalid reply.'));
          socket.destroy();
        }
      }
    });
    socket.once('error', (error) => {
      clearTimeout(connectTimer);
      reject(error);
    });
    socket.once('connect', () => {
      clearTimeout(connectTimer);
      socket.removeAllListeners('error');
      socket.on('error', () => undefined); // surfaced through `closed`
      resolve({
        request: (request) =>
          new Promise((resolveReply, rejectReply) => {
            // Closed already (e.g. the helper ended the session after a failed apply): no answer is coming.
            if (socket.destroyed)
              return rejectReply(new Error('The network helper closed the connection.'));
            const timer = setTimeout(() => {
              rejectReply(new Error("The network helper didn't answer in time."));
              socket.destroy();
            }, REQUEST_TIMEOUT_MS);
            waiting.push({ resolve: resolveReply, reject: rejectReply, timer });
            socket.write(`${JSON.stringify(request)}\n`);
          }),
        close: () => socket.destroy(),
        closed,
      });
    });
  });
}

/** Version of the running helper, or undefined if nothing answers. Doesn't open a session. */
export async function helperVersion(port: number): Promise<number | undefined> {
  try {
    const connection = await openConnection(port);
    try {
      const reply = await connection.request({ command: 'status' });
      return reply.ok ? reply.version : undefined;
    } finally {
      connection.close();
    }
  } catch {
    return undefined;
  }
}

export interface HelperSession {
  /** Replaces the helper's routing state; no tunnels removes everything. */
  apply(routes: HostRoutes): Promise<void>;
  close(): void;
  /** Resolves when the session ends for any reason (helper restarted, crashed, or replaced). */
  closed: Promise<void>;
}

/**
 * Opens an authenticated session via the mutual challenge-response. The token
 * never leaves this process, and nothing is sent to a listener that can't prove
 * it is the installed helper. While the session is open the helper keeps our
 * routes; when it closes, they're removed.
 */
export async function openHelperSession({
  port,
  token,
}: {
  port: number;
  token: string;
}): Promise<HelperSession> {
  const key = helperKey(token);
  const sign = (message: string) => signProof(key, message);

  const connection = await openConnection(port).catch(() => {
    throw new Error("The network helper isn't running. Reinstall it from the app.");
  });
  try {
    const status = await connection.request({ command: 'status' });
    if (!status.ok || status.version !== HELPER_VERSION)
      throw new Error('The network helper is out of date. Update it from the app.');

    const nonce = randomBytes(32).toString('base64url');
    const hello = HelloReply.safeParse(await connection.request({ command: 'hello', nonce }));
    if (!hello.success || !proofMatches(hello.data.proof, sign(helperProofMessage(nonce)))) {
      throw new Error(
        "Whatever answered on the helper's port couldn't prove it's the installed helper, so nothing was sent. Reinstall the helper.",
      );
    }
    const auth = await connection.request({
      command: 'auth',
      proof: sign(appProofMessage(hello.data.challenge)),
    });
    if (!auth.ok) throw new Error('The network helper rejected this app. Reinstall it.');
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    async apply(routes) {
      const reply = await connection.request({ command: 'apply', routes });
      if (!reply.ok) throw new Error(`The network helper refused the routes: ${reply.error}`);
    },
    close: connection.close,
    closed: connection.closed,
  };
}
