import type { VpnKind } from '@repo/vpns';

/** Live connection state of one VPN, shared by the engine (main process) and the UI. */
export type ConnectionState =
  | { state: 'disconnected' }
  | { state: 'connecting'; step: string }
  /** The VPN client waits for something only the user has, e.g. an SMS code. `prompt` is the gateway's own wording. */
  | { state: 'awaiting-code'; prompt: string; secret: boolean }
  /** The user signs in in the browser (e.g. Microsoft Entra ID with Authenticator); the app opened the page. */
  | { state: 'awaiting-browser' }
  /** Signing in takes a smart card, and no reader holds one yet. `card` is what to call it: "ID card" or "smart card". */
  | { state: 'awaiting-card'; card: string }
  | { state: 'connected'; since: number; warning: string | undefined }
  | { state: 'error'; message: string };

/** State plus the recent engine log (the client's output, setup steps). */
export type ConnectionStatus = ConnectionState & { log: string[] };

/**
 * `needsPassword`: it needs the login password, which isn't remembered; ask and retry.
 * `untrustedCertificate`: a server's certificate isn't publicly trusted (or no longer matches
 * the one trusted before); the user can trust this exact one (by its pin) and retry.
 */
export type ConnectResult =
  | { ok: true }
  | { ok: false; needsPassword: true }
  | { ok: false; untrustedCertificate: { pin: string; server: string; changed: boolean } }
  | { ok: false; error: string };

/**
 * What an address turned out to be, from probing it the way each vendor's own client starts (engine: detect.ts).
 * `browserSignIn`: its server signs in through the browser.
 */
export type Detection = { kind: VpnKind; address: string; browserSignIn?: boolean } | { kind: 'unknown' };

/** Docker as the setup screens see it. */
export type DockerState = 'running' | 'stopped' | 'missing';

/** Live traffic through the VPNs (the normal connection is never seen). */
export interface TrafficSnapshot {
  /** Bytes per second over the last minute, oldest first, per connected VPN id. */
  rates: Record<string, number[]>;
  /** Hosts the VPNs carried in the last five minutes, newest first. */
  destinations: { host: string; vpnId: string; bytes: number; last: number }[];
}
