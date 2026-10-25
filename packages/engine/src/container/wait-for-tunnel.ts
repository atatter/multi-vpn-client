import type { ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { Docker } from '../docker.ts';
import { markers } from '@repo/vpn-sdk/container';
import type { BrowserSignIn } from '@repo/vpn-sdk/engine';
import { classifyLine, UntrustedCertificateError } from './output.ts';
import type { StartOptions } from './start.ts';

/** How long the client may take to connect, from its start or from the user's last answer. */
const CONNECT_TIMEOUT_MS = 90_000;

/**
 * Reads the client's output (`follower`, the container's log stream) until it reports the tunnel up,
 * relaying its prompts and browser sign-ins to the user meanwhile; only markers carrying `nonce` count. Rejects
 * when it fails, times out, stops first, or `signal` aborts. After connecting, the stream's end calls `onExit`
 * unless `isStopped`.
 */
export function waitForTunnel(
  {
    docker,
    name,
    follower,
    nonce,
  }: {
    docker: Docker;
    name: string;
    follower: ChildProcessByStdio<null, Readable, Readable>;
    nonce: string;
  },
  options: StartOptions,
  isStopped: () => boolean,
): Promise<void> {
  const { launch } = options;
  const connectMarkers = markers(nonce);
  const lastLines: string[] = [];
  let connected = false;
  return new Promise<void>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined;
    let failed = false;
    const fail = (error: unknown) => {
      failed = true;
      clearTimeout(timeout);
      reject(error);
    };
    // Paused while a prompt waits for the user, so a slow SMS doesn't count against the client.
    const startTimeout = () => {
      timeout = setTimeout(
        () =>
          fail(
            new Error(
              `The VPN didn't connect within ${CONNECT_TIMEOUT_MS / 1000} seconds. See the log for details.`,
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
    };
    /** Waits for the user (the connect timeout paused), then hands what they gave to the client. */
    const waitForUser = async (deliver: () => Promise<unknown>) => {
      clearTimeout(timeout);
      try {
        await deliver();
        if (!connected && !failed) {
          startTimeout();
        }
      } catch (error) {
        fail(error);
      }
    };
    // An answer goes to the client as one line on its answers FIFO; control characters (e.g. Ctrl-C) would reach its terminal.
    const answer = (prompt: string) =>
      waitForUser(async () => {
        const reply = await options.onPrompt(prompt);
        // Control characters are stripped on purpose: a reply is one line for the client, nothing more.
        await docker.runChecked(
          ['exec', '-i', name, 'sh', '-c', 'cat > /run/mvpn/answers'],
          // oxlint-disable-next-line no-control-regex
          `${reply.replace(/[\x00-\x1f\x7f]/g, '')}\n`,
        );
      });
    // A browser sign-in's token goes to the client's listener inside the container.
    const signIn = (request: BrowserSignIn) =>
      waitForUser(async () => {
        const token = await options.onBrowserSignIn(request);
        // The URL goes in on stdin (curl --config -), so the token never shows in a process list.
        await docker.runChecked(
          [
            'exec',
            '-i',
            name,
            'curl',
            '-fsS',
            '--max-time',
            '10',
            '-o',
            '/dev/null',
            '--config',
            '-',
          ],
          `url = "http://127.0.0.1:${request.tokenPort}/${token}"\n`,
        );
      });
    startTimeout();
    if (options.signal.aborted) {
      fail(options.signal.reason);
    }
    options.signal.addEventListener(
      'abort',
      () => {
        if (!connected) {
          fail(options.signal.reason);
        }
      },
      { once: true },
    );
    // The card stops being available if it's removed from the reader. Before connecting, that ends the connect.
    options.cardBridge?.attach(docker.bin, name, (message) => {
      options.onLog(message);
      if (!connected) {
        fail(new Error(message));
      }
    });
    const onLine = (line: string) => {
      options.onLog(line);
      lastLines.push(line);
      if (lastLines.length > 30) {
        lastLines.shift();
      }
      const meaning = classifyLine(line, launch.readLine, connectMarkers);
      if (meaning === undefined || connected || failed) {
        return;
      }
      if (meaning === 'connected') {
        connected = true;
        clearTimeout(timeout);
        resolve();
      } else if ('prompt' in meaning) {
        void answer(meaning.prompt);
      } else if ('signInUrl' in meaning) {
        void signIn(meaning);
      } else {
        fail(
          meaning.untrustedPin
            ? new UntrustedCertificateError(
                meaning.failed,
                meaning.untrustedPin,
                meaning.server ?? '',
              )
            : new Error(meaning.failed),
        );
      }
    };
    createInterface({ input: follower.stdout }).on('line', onLine);
    createInterface({ input: follower.stderr }).on('line', onLine);
    // Registered before the tunnel is reported up, so an exit right after connecting is never missed.
    follower.on('close', () => {
      clearTimeout(timeout);
      if (!connected) {
        reject(
          new Error(
            `${launch.client} stopped before connecting: ${lastLines.at(-1) ?? 'no output'}`,
          ),
        );
      } else if (!isStopped()) {
        options.onExit([...lastLines]);
      }
    });
  });
}
