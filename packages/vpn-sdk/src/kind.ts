import { z } from 'zod';
import type { CommonSettings } from './fields.ts';

/**
 * What every process knows about one VPN kind: its saved settings and the decisions every kind has to make.
 * Each kind's `kind.ts` in @repo/vpns calls defineKind; its engine side (engine.ts) and window side (ui.ts)
 * are registered per kind too, so a new kind doesn't compile until each process has decided.
 */

/** One secret a kind keeps in the secret store. Values never travel back to the UI; it only learns which slots are set. */
export interface SecretSlot {
  key: string;
  label: string;
  /** "always": part of the setup (OpenVPN's profile). "remember": the login password (PASSWORD_SLOT), kept only if the user opts in. */
  storage: 'always' | 'remember';
  /** Must be stored before the VPN can connect. "remember" slots are asked for at connect time instead. */
  required: boolean;
  /** Only set by importing a file (e.g. the .ovpn profile), never typed in. */
  importOnly: boolean;
  /** Settings read from this file (OpenVPN's `remotes`); the window shows their errors on the file's field. */
  fills?: readonly string[];
  schema: z.ZodType<string>;
}

/** The login password: asked for on connect, kept only when the user ticks "Remember password". */
export const PASSWORD_SLOT = {
  key: 'password',
  label: 'Password',
  storage: 'remember',
  required: false,
  importOnly: false,
  schema: z.string().min(1),
} as const satisfies SecretSlot;

/**
 * An action: something a kind's form asks its engine for, e.g. the login types a Check Point gateway offers. It
 * crosses from the window to the main process, so both ends are parsed: the input in main, the output in the window.
 */
export interface Action {
  input: z.ZodType;
  output: z.ZodType;
}

/** A provider's file a kind is set up from (OpenVPN's .ovpn): choosing or dropping one creates the VPN. */
export interface FromFile<V> {
  /** Lower-case, with the dot; the first is what the window names. */
  extensions: readonly string[];
  /** The new VPN `draft` with what the file says, and the secrets it holds; or why the file isn't one of this kind's. */
  read: (text: string, draft: V) => { ok: true; vpn: V; secrets: Record<string, string> } | { ok: false; error: string };
}

export interface KindSpec<V> {
  /** A fresh VPN of this kind: the shared settings plus its own defaults (empty, safest options picked). */
  create: (common: CommonSettings) => V;
  /** The server or address it connects to, as typed; what the window shows. */
  address: (vpn: V) => string;
  /** The same VPN pointed at another address; what typing an address in the add flow creates. */
  withAddress: (vpn: V, address: string) => V;
  /**
   * Every host it connects to, without ports (e.g. GlobalProtect's portal and gateway). They're kept off all
   * tunnels (host.ts), so a tunnel never routes into itself; a host missing here can loop a VPN's own traffic.
   */
  hosts: (vpn: V) => string[];
  secrets: readonly SecretSlot[];
  /** Whether the app can learn what its server sends, so "same as the official app" can apply. */
  followsServerRoutes: boolean;
  /** Set up from a provider's file, if it can be (renderer: store/import-profile.ts). */
  fromFile?: FromFile<V>;
  /**
   * Its actions by name. The kind file exports them too (`satisfies Record<string, Action>`), so its engine
   * (implement) and form (callAction) get them typed; this copy lets a test check the engine implements exactly
   * these (engine: manager/launch-for.test.ts).
   */
  actions?: Readonly<Record<string, Action>>;
}

/**
 * One kind: its schema (the shared settings spread in, plus a `kind` literal), and its spec, typed from the
 * schema so every callback gets exactly this kind's VPN.
 */
export const defineKind = <S extends z.ZodObject>(schema: S, spec: NoInfer<KindSpec<z.output<S>>>) => ({ schema, ...spec });
