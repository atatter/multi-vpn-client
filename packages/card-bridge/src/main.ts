import {
  openPcsc,
  PcscError,
  SCARD_E_NO_SERVICE,
  SCARD_E_SERVICE_STOPPED,
  SCARD_W_REMOVED_CARD,
  SCARD_W_RESET_CARD,
  type Card,
  type Pcsc,
} from './pcsc.ts';
import { createFramer, frame, ID_CARD_GUARDED_PINS, refusal, VPCD_CTRL_ATR } from './vpcd.ts';

/**
 * Lends the smart card in this computer's reader (e.g. an Estonian ID card) to one VPN container,
 * whose pcscd sees it in a virtual reader (vsmartcard's vpcd). The app runs it unprivileged, one
 * per VPN that signs in with a card, and relays its stdin/stdout to the container (docker exec).
 *
 *   --id-card      lend only an Estonian ID card, whose PIN2 and PUK the bridge guards (see vpcd.ts);
 *                  other cards are never lent, and it keeps waiting for an ID card
 *   stdin, stdout  vpcd's messages (see vpcd.ts)
 *   stderr         status for the app, one per line:
 *                    MVPN-CARD-WAITING        no card yet; it waits for one to be inserted
 *                    MVPN-CARD: <reader>      relaying the card in this reader
 *                    MVPN-ERROR: <message>    gave up
 *
 * The card stays shared with the rest of the computer: while the container sends commands, the
 * bridge holds a PC/SC transaction, so another program can't change the card's state in between.
 */

/** Released this long after the container's last command, so other programs get the card back. */
const TRANSACTION_IDLE_MS = 1500;

const status = (line: string) => process.stderr.write(`${line}\n`);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

const idCardOnly = process.argv.includes('--id-card');
let reportedOtherCards = false;

/**
 * The card to lend, once there is one: an Estonian ID card if any reader holds one, else (without
 * --id-card) the first card found.
 */
function findCard(pcsc: Pcsc): Card | undefined {
  const cards: Card[] = [];
  for (const reader of pcsc.readers()) {
    try {
      cards.push(pcsc.connect(reader));
    } catch (error) {
      if (!(error instanceof PcscError)) throw error;
    }
  }
  const chosen =
    cards.find((card) => ID_CARD_GUARDED_PINS.has(hex(card.atr))) ??
    (idCardOnly ? undefined : cards[0]);
  if (!chosen && cards.length > 0 && !reportedOtherCards) {
    reportedOtherCards = true;
    status(
      `Not an Estonian ID card the app knows, so it isn't used: the card in ${cards.map((card) => card.reader).join(', ')}.`,
    );
  }
  for (const card of cards) if (card !== chosen) card.disconnect();
  return chosen;
}

/** The smart card API, or nothing while its service isn't running (Windows stops it when the last reader goes). */
function openPcscIfRunning(): Pcsc | undefined {
  try {
    return openPcsc();
  } catch (error) {
    if (
      error instanceof PcscError &&
      (error.code === SCARD_E_NO_SERVICE || error.code === SCARD_E_SERVICE_STOPPED)
    )
      return undefined;
    throw error;
  }
}

async function waitForCard(): Promise<Card> {
  let announced = false;
  for (;;) {
    // A fresh context each time, since the service may have stopped or started in between.
    const pcsc = openPcscIfRunning();
    const card = pcsc && findCard(pcsc);
    if (card) return card;
    pcsc?.close();
    if (!announced) status('MVPN-CARD-WAITING');
    announced = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function relay(card: Card) {
  const guarded = ID_CARD_GUARDED_PINS.get(hex(card.atr));
  let inTransaction = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (inTransaction) {
      inTransaction = false;
      try {
        card.endTransaction();
      } catch {
        // the card went away; the next command reports it
      }
    }
  };

  const begin = () => {
    if (inTransaction) return;
    try {
      card.beginTransaction();
      inTransaction = true;
    } catch (error) {
      // Another program holds the card exclusively for a moment: send without a transaction, but say so.
      process.stderr.write(`Sending without a card transaction: ${String(error)}\n`);
    }
  };

  const transmit = (apdu: Uint8Array): Uint8Array => {
    begin();
    clearTimeout(idle);
    idle = setTimeout(release, TRANSACTION_IDLE_MS);
    try {
      return card.transmit(apdu);
    } catch (error) {
      if (!(error instanceof PcscError) || error.code !== SCARD_W_RESET_CARD) throw error;
      // Another program reset the card. The container finds out from the card's answers, as with a real reader.
      inTransaction = false;
      card.reconnect();
      begin();
      return card.transmit(apdu);
    }
  };

  const answer = (message: Uint8Array) => {
    if (message.length === 1) {
      // Power on, off and reset get no reply. The card stays powered: other programs share it.
      if (message[0] === VPCD_CTRL_ATR) process.stdout.write(frame(card.atr));
      return;
    }
    try {
      process.stdout.write(frame(refusal(message, guarded) ?? transmit(message)));
    } catch (error) {
      const removed = error instanceof PcscError && error.code === SCARD_W_REMOVED_CARD;
      status(
        `MVPN-ERROR: ${removed ? 'The card was removed from the reader.' : `The card reader stopped working: ${String(error)}`}`,
      );
      process.exit(1);
    }
  };

  process.stdin.on('data', createFramer(answer));
  process.stdin.on('end', () => {
    release();
    card.disconnect();
    process.exit(0);
  });
}

try {
  const card = await waitForCard();
  status(`MVPN-CARD: ${card.reader}`);
  relay(card);
} catch (error) {
  status(`MVPN-ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
