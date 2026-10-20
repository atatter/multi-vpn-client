// How the app reads a VPN container's output: the container's own marker lines, then the client's log.
import type { markers } from "@repo/vpn-sdk/container";
import type { BrowserSignIn, Failure, ReadLine } from "@repo/vpn-sdk/engine";

/** A server's certificate wasn't trusted; `pin` identifies the one it presented. */
export class UntrustedCertificateError extends Error {
  readonly pin: string;
  readonly server: string;
  constructor(message: string, pin: string, server: string) {
    super(message);
    this.pin = pin;
    this.server = server;
  }
}

/** The user cancelled the connect (a prompt's Cancel, or a disconnect while connecting). Not a failure to report. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled.");
  }
}

/** Reads this connect's markers first, then the client's own output. Markers start the line. */
export function classifyLine(
  line: string,
  readLine: ReadLine,
  { ready, error, prompt }: ReturnType<typeof markers>,
): "connected" | Failure | BrowserSignIn | { prompt: string } | undefined {
  const trimmed = line.trim();
  if (trimmed === ready) return "connected";
  if (trimmed.startsWith(error)) return { failed: trimmed.slice(error.length).trim() };
  if (trimmed.startsWith(prompt)) return { prompt: trimmed.slice(prompt.length).trim() };
  return readLine(line);
}
