import type {
  Config,
  ConnectionStatus,
  ConnectResult,
  Detection,
  DockerState,
  HelperState,
  SecretChanges,
  SecretStatus,
  TrafficSnapshot,
} from '@repo/core';

/**
 * Single source of truth for main ⇄ renderer IPC. Main registers handlers and
 * the preload exposes invokers from this map, so both sides stay in sync.
 */
export interface IpcContract {
  'config:load': { args: []; result: Loaded };
  'config:save': { args: [config: Config, secrets: SecretChanges]; result: SaveResult };
  /** Works out a VPN's type from its address (what the user would type into the vendor's app). */
  'vpn:detect': { args: [address: string]; result: Detection };
  /** Which connected VPN carries traffic to a site right now; `site` is what was understood from the text. */
  'route:check': {
    args: [text: string];
    result: { site: string; vpnId: string | null } | { site: null };
  };
  'docker:state': { args: []; result: DockerState };
  'docker:start': { args: []; result: HelperActionResult };
  /** `password` is a one-off login password when it isn't remembered; null otherwise. */
  'vpn:connect': { args: [vpnId: string, password: string | null]; result: ConnectResult };
  'vpn:disconnect': { args: [vpnId: string]; result: void };
  'vpn:statuses': { args: []; result: ConnectionStatuses };
  /** Answers what the VPN's client is asking while connecting (state "awaiting-code"); null cancels the connect. */
  'vpn:answer': { args: [vpnId: string, reply: string | null]; result: void };
  /** Opens the VPN's browser sign-in page again (state "awaiting-browser"). */
  'vpn:reopen-sign-in': { args: [vpnId: string]; result: void };
  /** Runs one of a VPN type's actions (e.g. Check Point's login types); the form parses the result. */
  'vpn:action': { args: [kind: string, name: string, input: unknown]; result: unknown };
  /** Trusts the certificate the VPN's gateway presented on the last connect; returns the saved config. */
  'vpn:trust-certificate': { args: [vpnId: string]; result: Config };
  'helper:state': { args: []; result: HelperInfo };
  'helper:install': { args: []; result: HelperActionResult };
  'helper:uninstall': { args: []; result: HelperActionResult };
  'app:info': { args: []; result: AppInfo };
  /** Reveals the settings file in Finder, Explorer or the file manager. */
  'app:show-config': { args: []; result: void };
  /** Sizes the window to the renderer's content height (the width is fixed). */
  'window:fit': { args: [height: number]; result: void };
  'update:state': { args: []; result: UpdateState };
  /** Asks npm for a newer version now; resolves once it has answered. */
  'update:check': { args: []; result: void };
  /** Downloads the newer version found by a check; resolves once it's ready or failed. */
  'update:download': { args: []; result: void };
  /** Quits (turning every VPN off) and starts the downloaded version. */
  'update:restart': { args: []; result: void };
}

export interface AppInfo {
  version: string;
  platform: 'darwin' | 'win32' | 'linux';
}

/** The privileged network helper: installed once, then connecting needs no admin prompt. */
export interface HelperInfo {
  state: HelperState;
  logHint: string;
}

export type HelperActionResult = { ok: true } | { ok: false; error: string };

/**
 * Where updating the app stands. Main checks npm at start, every hour and when the window comes to the front; nothing
 * downloads until the user asks.
 */
export type UpdateState =
  /** A development build, which never updates. */
  | { state: 'off' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'current'; checkedAt: number }
  /** `size` in bytes; undefined when the release has no archive for this machine. */
  | { state: 'available'; version: string; size: number | undefined }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  /** Turning VPNs off, then quitting into `version`. The window stays until the app quits. */
  | { state: 'restarting'; version: string }
  | { state: 'check-failed'; error: string }
  | { state: 'download-failed'; version: string; error: string };

export type IpcChannel = keyof IpcContract;

/** Pushed from main to the renderer. */
export interface IpcEvents {
  'vpn:status': ConnectionStatuses;
  /** About once a second while anything is connected. */
  'traffic:update': TrafficSnapshot;
  /** The app changed the saved config itself, e.g. learned what a VPN's server sends. */
  'config:changed': Config;
  'update:changed': UpdateState;
}

export type ConnectionStatuses = Record<string, ConnectionStatus>;

export interface Loaded {
  path: string;
  config: Config;
  secretStatus: SecretStatus;
  /** Why secrets can't be stored on this machine, if they can't. */
  keychainProblem: string | undefined;
}

export type SaveResult =
  | { ok: true; config: Config; secretStatus: SecretStatus }
  | { ok: false; issues: { path: string; message: string }[] };
