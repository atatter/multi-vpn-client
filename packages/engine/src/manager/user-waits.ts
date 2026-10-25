import { receiveBrowserToken } from '../browser-sign-in.ts';
import { type BrowserSignIn, CARD_NAME, type VpnLaunch } from '@repo/vpn-sdk/engine';
import { CancelledError } from '../container/output.ts';
import { openCardBridge, type CardBridge } from '../smart-card.ts';
import type { StatusBoard } from './statuses.ts';

/** How long a prompt (e.g. for an SMS code) waits for the user. Codes expire within minutes anyway. */
const PROMPT_TIMEOUT_MS = 3 * 60_000;

/** How long a browser sign-in may take; the VPN client gives up after 2 minutes, too. */
const BROWSER_SIGN_IN_TIMEOUT_MS = 2 * 60_000;

/** How long a connect waits for a smart card to be inserted. */
const CARD_TIMEOUT_MS = 3 * 60_000;

/**
 * Prompts get a masked field unless they ask for a username or a one-time code (easier to type
 * visibly); whatever else a gateway asks, in any language, might be a password. A password or PIN always is.
 */
const isSecretPrompt = (prompt: string) =>
  /pass|\bpin\b/i.test(prompt) || !/user|login|e-?mail|\bcode\b|\botp\b|token/i.test(prompt);

/**
 * What connecting VPNs wait on from the user: a prompt to answer, a browser sign-in, or a smart card.
 * Each wait shows in the VPN's status and can be cancelled, which ends its connect.
 */
export function createUserWaits({
  statuses,
  openUrl,
  cardBridgeBinary,
}: {
  statuses: StatusBoard;
  openUrl: (url: string) => void;
  cardBridgeBinary: string;
}) {
  /** What each connecting VPN waits on: a prompt to answer, a browser sign-in (reopenable), or a card. */
  const waits = new Map<
    string,
    { cancel: (error: Error) => void; answer?: (reply: string) => void; url?: string }
  >();
  /** Ports a browser sign-in listens on. The gateway's page sends its token to a fixed one, so one VPN at a time. */
  const browserPorts = new Set<number>();

  return {
    /** Shows the client's prompt in the VPN's row and waits for the user's answer (or a cancel, or the timeout). */
    ask(vpnId: string, prompt: string, resumeStep: string): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            settle(() =>
              reject(
                new Error(
                  `Nothing was entered within ${PROMPT_TIMEOUT_MS / 60_000} minutes. Connect again to retry.`,
                ),
              ),
            ),
          PROMPT_TIMEOUT_MS,
        );
        const settle = (finish: () => void) => {
          clearTimeout(timer);
          waits.delete(vpnId);
          statuses.set(vpnId, { state: 'connecting', step: resumeStep });
          finish();
        };
        waits.set(vpnId, {
          answer: (reply) => settle(() => resolve(reply)),
          cancel: (error) => settle(() => reject(error)),
        });
        statuses.set(vpnId, { state: 'awaiting-code', prompt, secret: isSecretPrompt(prompt) });
      });
    },

    /** Opens the sign-in page in the user's browser and waits for the token it hands back (or a cancel). */
    signInWithBrowser(vpnId: string, { signInUrl, tokenPort }: BrowserSignIn): Promise<string> {
      if (browserPorts.has(tokenPort)) {
        return Promise.reject(
          new Error(
            'Another VPN is waiting for its browser sign-in. Finish or cancel that one, then connect again.',
          ),
        );
      }
      browserPorts.add(tokenPort);
      const wait = receiveBrowserToken(tokenPort, BROWSER_SIGN_IN_TIMEOUT_MS);
      waits.set(vpnId, { cancel: (error) => wait.cancel(error), url: signInUrl });
      statuses.set(vpnId, { state: 'awaiting-browser' });
      openUrl(signInUrl);
      return wait.token.finally(() => {
        browserPorts.delete(tokenPort);
        waits.delete(vpnId);
        statuses.set(vpnId, { state: 'connecting', step: 'Signing in…' });
      });
    },

    /**
     * Starts the card bridge and waits until there's a card in a reader (asking for one meanwhile),
     * for a sign-in with a smart card. Cancelled like a prompt.
     */
    findCard(vpnId: string, smartCard: NonNullable<VpnLaunch['smartCard']>): Promise<CardBridge> {
      const search = new AbortController();
      const timer = setTimeout(
        () =>
          search.abort(
            new Error(`No card was inserted within ${CARD_TIMEOUT_MS / 60_000} minutes.`),
          ),
        CARD_TIMEOUT_MS,
      );
      waits.set(vpnId, { cancel: (error) => search.abort(error) });
      const onWaiting = () =>
        statuses.set(vpnId, { state: 'awaiting-card', card: CARD_NAME[smartCard] });
      return openCardBridge(cardBridgeBinary, {
        idCardOnly: smartCard === 'id-card',
        onWaiting,
        onLog: statuses.logger(vpnId),
        signal: search.signal,
      }).finally(() => {
        clearTimeout(timer);
        waits.delete(vpnId);
      });
    },

    /** Ends what a connecting VPN waits on as cancelled, so its connect gives up right away. */
    cancel: (vpnId: string) => waits.get(vpnId)?.cancel(new CancelledError()),

    /** Answers the prompt this VPN's client is waiting on (e.g. the SMS code); null cancels the connect. */
    answer(vpnId: string, reply: string | null) {
      const wait = waits.get(vpnId);
      if (!wait) throw new Error("This VPN isn't waiting for you anymore.");
      if (reply === null) wait.cancel(new CancelledError());
      else if (wait.answer) wait.answer(reply);
      else throw new Error("This VPN isn't asking for a code or PIN.");
    },

    /** Opens this VPN's browser sign-in page again (e.g. after the tab was closed). */
    reopenSignIn(vpnId: string) {
      const url = waits.get(vpnId)?.url;
      if (!url) throw new Error("This VPN isn't waiting for a browser sign-in anymore.");
      openUrl(url);
    },
  };
}
