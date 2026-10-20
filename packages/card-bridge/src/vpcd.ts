/**
 * The protocol of vsmartcard's virtual reader driver (vpcd), which the VPN container's pcscd
 * loads: every message is a 2-byte big-endian length, then that many bytes. vpcd sends a
 * one-byte control message (0 power off, 1 on, 2 reset, 4 ATR request) or a command APDU; we
 * answer the ATR request and each APDU (but not power on, off or reset) with one message.
 */

export const VPCD_CTRL_ATR = 4;

/** Splits vpcd's byte stream into messages, however it arrives in chunks. */
export function createFramer(onMessage: (message: Uint8Array) => void) {
  let pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  return (chunk: Uint8Array) => {
    const joined = new Uint8Array(pending.length + chunk.length);
    joined.set(pending);
    joined.set(chunk, pending.length);
    let offset = 0;
    while (joined.length - offset >= 2) {
      const length = ((joined[offset] ?? 0) << 8) | (joined[offset + 1] ?? 0);
      if (joined.length - offset - 2 < length) break;
      onMessage(joined.slice(offset + 2, offset + 2 + length));
      offset += 2 + length;
    }
    pending = joined.slice(offset);
  };
}

/** One message as vpcd expects it. Its 2-byte length can't describe more than 65535 bytes, so longer ones throw. */
export function frame(message: Uint8Array): Uint8Array {
  if (message.length > 0xffff) throw new RangeError(`A ${message.length}-byte message doesn't fit vpcd's framing.`);
  const framed = new Uint8Array(message.length + 2);
  framed[0] = message.length >> 8;
  framed[1] = message.length & 0xff;
  framed.set(message, 2);
  return framed;
}

// Status words for commands the bridge refuses to pass on.
const INS_NOT_SUPPORTED = Uint8Array.of(0x6d, 0x00);
const SECURITY_NOT_SATISFIED = Uint8Array.of(0x69, 0x82);
const WRONG_LENGTH = Uint8Array.of(0x67, 0x00);

/**
 * Estonian ID cards by ATR, with the references of the PINs a sign-in never verifies: the signing
 * PIN (PIN2), which unlocks legally binding signatures, and the PUK, which unblocks the others.
 * Signing in uses PIN1. From OpenSC's esteid2018 and esteid2025 drivers.
 */
export const ID_CARD_GUARDED_PINS = new Map<string, readonly number[]>([
  ["3bdb960080b1fe451f830012233f536549440f9000f1", [0x85, 0x02]], // EstEID 2018 (IDEMIA)
  ["3bdc960080b1fe451f830012233f54654944320f9000c3", [0x85, 0x02]], // EstEID 2018 v2 (IDEMIA, 2025)
  ["3bff9600008031fe438031b85365494464b085051012233f1d", [0x82, 0x83]], // EstEID 2025 (Thales)
]);
/**
 * Instructions a VPN sign-in never needs and the bridge refuses: changing a PIN (CHANGE REFERENCE
 * DATA), turning its check off or on (DISABLE / ENABLE VERIFICATION REQUIREMENT) and unblocking
 * one with the PUK (RESET RETRY COUNTER). The container can't touch the card's PINs except to
 * verify the one the user typed.
 */
const REFUSED_INSTRUCTIONS = new Set([0x24, 0x26, 0x28, 0x2c]);

const VERIFY = 0x20;

/**
 * The response to send instead of passing the command on, if the bridge refuses it. On an Estonian
 * ID card (`guarded`: its entry in ID_CARD_GUARDED_PINS), verifying PIN2 or the PUK is refused too,
 * so a container can never unlock the signing key or use up those PINs' tries. A PIN is matched by
 * its number whether the reference is local (bit 8 set) or global. An odd instruction is the same
 * command with its data in BER-TLV (ISO 7816-4), so it's matched by its even form.
 */
export function refusal(apdu: Uint8Array, guarded: readonly number[] = []): Uint8Array | undefined {
  const [, instruction, , reference] = apdu;
  // Too short to be a command at all: refused, so nothing unchecked reaches the card.
  if (apdu.length < 4 || instruction === undefined) return WRONG_LENGTH;
  const command = instruction & 0xfe;
  if (REFUSED_INSTRUCTIONS.has(command)) return INS_NOT_SUPPORTED;
  if (command === VERIFY && guarded.some((pin) => (pin & 0x7f) === ((reference ?? 0) & 0x7f))) return SECURITY_NOT_SATISFIED;
  return undefined;
}
