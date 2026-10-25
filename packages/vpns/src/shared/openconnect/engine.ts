import type { Failure, ReadLine } from '@repo/vpn-sdk/engine';

/**
 * What every VPN kind that runs through OpenConnect shares (FortiGate SSL VPN, Palo Alto GlobalProtect):
 * reading its certificate errors and its extra arguments. Each setting is its own argument (no shell), so
 * none can inject options; the password goes in on stdin, which answers OpenConnect's prompts in order
 * (except with a smart card, see globalprotect/engine.ts).
 */

/** A certificate pin as OpenConnect prints it: SHA-256 of the public key, base64. */
const PIN = 'pin-sha256:[A-Za-z0-9+/]{43}=';

/** OpenConnect's hint when it doesn't trust a server's certificate: "    --servercert pin-sha256:…". */
const UNTRUSTED = new RegExp(`^\\s*--servercert\\s+(${PIN})\\s*$`);

/** OpenConnect's error when a pinned certificate no longer matches: "…match server's certificate: pin-sha256:…". */
const PIN_MISMATCH = new RegExp(`specified via --servercert match server's certificate: (${PIN})`);

/** Splits the VPN's Advanced box into extra OpenConnect arguments, one per whitespace-separated word. */
export const extraArguments = (advanced: string) => advanced.split(/\s+/).filter(Boolean);

/**
 * Reads what every OpenConnect protocol prints: untrusted or changed certificates (with the
 * server that presented them, which can be a gateway the portal redirected to), then the
 * protocol's own messages.
 */
export function readOpenConnect(firstServer: string, readProtocol: (line: string) => Failure | undefined): ReadLine {
  let server = firstServer;
  return (line) => {
    const negotiating = /^SSL negotiation with (\S+)/.exec(line)?.[1];
    if (negotiating) server = negotiating;
    const changed = PIN_MISMATCH.exec(line)?.[1];
    if (changed) return { failed: `${server} presented a different certificate than the one you trusted.`, untrustedPin: changed, server };
    const untrusted = UNTRUSTED.exec(line)?.[1];
    if (untrusted) return { failed: `${server}'s certificate isn't publicly trusted.`, untrustedPin: untrusted, server };
    return readProtocol(line);
  };
}

export const REJECTED: Failure = { failed: 'The VPN server rejected the username or password.' };
