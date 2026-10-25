import { createServer } from 'node:http';

/**
 * Receives the token a VPN gateway's browser sign-in page (e.g. Check Point with Microsoft
 * Entra ID) sends to http://localhost:<port>/<token> when sign-in is done. The VPN client
 * listens for it inside its container, where the browser can't reach, so the app listens on
 * the host instead and hands the token over (see container/wait-for-tunnel: signIn).
 */

/** Characters a token may have; it becomes part of a URL path, so nothing that could change the request. */
const TOKEN = /^[A-Za-z0-9._~%+=/-]{1,4096}$/;

/**
 * The page calls from the gateway's origin, so the reply has to allow that (and, in Chromium, a private network).
 * Like snx-rs's own listener, any page open meanwhile could send a token first; the gateway rejects a forged one.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
  Connection: 'close',
};

export interface TokenWait {
  token: Promise<string>;
  /** Stops listening; a pending `token` rejects with `reason`. */
  cancel(reason: Error): void;
}

/** Listens on 127.0.0.1:`port` until the first request carrying a token, or `timeoutMs`. */
export function receiveBrowserToken(port: number, timeoutMs: number): TokenWait {
  let settle: { resolve: (token: string) => void; reject: (error: Error) => void } | undefined;
  const token = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((request, response) => {
    // Like the client's own listener: the raw path is the token, and the first request with one counts, preflight or not.
    const candidate = ((request.url ?? '/').split('?')[0] ?? '').replace(/^\/+/, '');
    const valid =
      (request.method === 'GET' || request.method === 'OPTIONS') && TOKEN.test(candidate);
    response.writeHead(valid ? 200 : 400, CORS_HEADERS).end();
    if (valid) {
      finish(() => settle?.resolve(candidate));
    }
  });
  const timer = setTimeout(
    () =>
      finish(() =>
        settle?.reject(
          new Error(
            `The browser sign-in didn't finish within ${Math.round(timeoutMs / 1000)} seconds. Connect again to retry.`,
          ),
        ),
      ),
    timeoutMs,
  );
  const finish = (done: () => void) => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
    done();
    settle = undefined;
  };
  server.once('error', (error: NodeJS.ErrnoException) =>
    finish(() =>
      settle?.reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${port} is in use, so the browser sign-in can't finish. Quit other VPN apps that may be using it and try again.`,
            )
          : error,
      ),
    ),
  );
  server.listen(port, '127.0.0.1');
  return { token, cancel: (reason) => finish(() => settle?.reject(reason)) };
}
