// How a VPN container talks to the app: whole lines on its output, never the client's own log text.
// Every marker carries the connect's nonce, which the app copies into the container and a VPN server can't
// know, so text a server gets into the client's log (e.g. a portal's message) can't pass for a marker.

/** The nonce's file in /run/mvpn, copied in with the launch's other files. */
export const NONCE_FILE = 'nonce';

/** The marker lines for `nonce`: the engine matches them with the real one, scripts print them reading it from the file. */
export function markers(nonce: string) {
  return {
    ready: `MVPN-READY:${nonce}`,
    error: `MVPN-ERROR:${nonce}`,
    /** The client is waiting for the user to type something (e.g. an SMS code); the rest of the line is its prompt. */
    prompt: `MVPN-PROMPT:${nonce}`,
  };
}

/** The markers in a shell script. */
export const SH_MARKERS = markers(`$(cat /run/mvpn/${NONCE_FILE})`);
/** The markers in an expect (Tcl) script. */
export const TCL_MARKERS = markers(`[exec cat /run/mvpn/${NONCE_FILE}]`);
