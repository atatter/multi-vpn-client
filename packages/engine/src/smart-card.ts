import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { VPCD_PORT, VPCD_RELAY_SOURCE } from '@repo/vpn-sdk/container';

/**
 * Lends the smart card in this computer's reader (e.g. an Estonian ID card) to a VPN container,
 * through the card bridge (packages/card-bridge), which talks to the OS's smart card API. Docker
 * Desktop can't pass a card reader into a container, so the bridge relays the card's commands
 * instead: inside the container, pcscd sees the card in a virtual reader (vsmartcard's vpcd),
 * whose port `docker exec` connects the bridge to (with socat).
 */

/** Status lines on the bridge's stderr. */
const WAITING = 'MVPN-CARD-WAITING';
const CARD = 'MVPN-CARD:';
const ERROR = 'MVPN-ERROR:';

export interface CardBridge {
  /** The reader holding the card. */
  reader: string;
  /** Starts relaying to the container's virtual reader. `onFailure` is called once if it stops (e.g. the card was removed). */
  attach(dockerBin: string, container: string, onFailure: (message: string) => void): void;
  stop(): void;
}

/**
 * Starts the card bridge and resolves once it has found a card (with `idCardOnly`, an Estonian ID card;
 * any other card is never lent). While there is none, `onWaiting` is called (once) and it keeps looking.
 * Aborting the signal stops it and rejects with the reason.
 */
export function openCardBridge(
  binary: string,
  options: {
    idCardOnly: boolean;
    onWaiting: () => void;
    onLog: (line: string) => void;
    signal: AbortSignal;
  },
): Promise<CardBridge> {
  return new Promise((resolve, reject) => {
    const bridge = spawn(binary, options.idCardOnly ? ['--id-card'] : [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let found = false;
    let failed: ((message: string) => void) | undefined;
    let lastError: string | undefined;
    /** Why the bridge stopped, if it did after finding the card but before `attach` (e.g. the card was pulled). */
    let closedWith: string | undefined;
    let relay: { kill(): void } | undefined;
    const stop = () => {
      bridge.kill();
      relay?.kill();
    };

    const abort = () => {
      stop();
      reject(options.signal.reason);
    };
    if (options.signal.aborted) {
      return abort();
    }

    options.signal.addEventListener('abort', abort, { once: true });

    bridge.on('error', (error) => {
      options.signal.removeEventListener('abort', abort);
      reject(new Error(`The card bridge couldn't start: ${error.message}`));
    });
    // Writing into a process that just exited fails with EPIPE; its close handler reports what happened.
    bridge.stdin.on('error', () => undefined);
    bridge.on('close', () => {
      relay?.kill();
      options.signal.removeEventListener('abort', abort);
      const message = lastError ?? 'The card bridge stopped.';

      if (!found) {
        reject(new Error(message));
      } else if (failed) {
        failed(message);
      } else {
        closedWith = message;
      }

      failed = undefined;
    });
    createInterface({ input: bridge.stderr }).on('line', (line) => {
      if (line === WAITING) {
        options.onWaiting();
      } else if (line.startsWith(ERROR)) {
        lastError = line.slice(ERROR.length).trim();
      } else if (line.startsWith(CARD) && !found) {
        found = true;
        options.signal.removeEventListener('abort', abort);
        resolve({
          reader: line.slice(CARD.length).trim(),
          attach(dockerBin, container, onFailure) {
            if (closedWith !== undefined) {
              return onFailure(closedWith);
            }

            failed = onFailure;
            const exec = spawn(
              dockerBin,
              [
                'exec',
                '-i',
                container,
                'socat',
                'STDIO',
                `TCP:127.0.0.1:${VPCD_PORT},bind=${VPCD_RELAY_SOURCE},retry=120,interval=0.25`,
              ],
              {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
              },
            );
            relay = exec;
            exec.stdin.on('error', () => undefined); // EPIPE, see bridge.stdin
            bridge.stdout.pipe(exec.stdin);
            exec.stdout.pipe(bridge.stdin);
            createInterface({ input: exec.stderr }).on('line', options.onLog);
            exec.on('error', (error) => {
              failed?.(`The card couldn't be connected to the VPN container: ${error.message}`);
              failed = undefined;
            });
            exec.on('close', () => {
              bridge.stdin.end();
              failed?.('The VPN container stopped using the card.');
              failed = undefined;
            });
          },
          stop() {
            failed = undefined;
            stop();
          },
        });
      } else if (line.trim()) {
        options.onLog(line);
      }
    });
  });
}
