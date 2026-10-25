import type { Action } from './kind.ts';
import type { VpnImage } from './container.ts';
import type { z } from 'zod';

/**
 * What a VPN kind's engine side is made of (Node only): how to run its client in a container, read the
 * client's output, recognise its server, and answer its form's actions. The engine calls these through
 * @repo/vpns's LAUNCHERS and knows no kind by name.
 */

/** Why the client stopped: a message, plus the certificate's pin and server when a certificate wasn't trusted. */
export interface Failure {
  failed: string;
  untrustedPin?: string;
  server?: string;
}

/**
 * The client wants the user to sign in in a browser (e.g. Microsoft Entra ID). The page hands a
 * token to http://localhost:<port>/<token>, where the client inside the container listens.
 */
export interface BrowserSignIn {
  signInUrl: string;
  tokenPort: number;
}

/** What a line of the client's output means for the connection: a failure, a browser sign-in, or nothing. */
export type ReadLine = (line: string) => Failure | BrowserSignIn | undefined;

/** What the user calls the card a launch's `smartCard` signs in with. */
export const CARD_NAME = { 'id-card': 'ID card', 'any-card': 'smart card' } as const;

/** How to run one VPN kind's client in the container. */
export interface VpnLaunch {
  /** Shown in messages, e.g. "OpenVPN". */
  client: string;
  image: VpnImage;
  /** Extra `docker create` flags this client needs. */
  createFlags?: readonly string[];
  /** Arguments after the image: the client (its start script, see ENTRY), then its own arguments. */
  command: readonly string[];
  /** Files for /run/mvpn (profiles, credentials), copied in with `docker cp`. */
  files: Readonly<Record<string, string>>;
  readLine: ReadLine;
  /** Shown while the client signs in, e.g. to tell the user to approve a push on their phone. */
  signInStep?: string;
  /**
   * Signs in with the smart card in the computer's reader, which the card bridge lends to the container:
   * only an Estonian ID card (whose PIN2 and PUK the bridge guards), or any card (a custom certificate).
   */
  smartCard?: keyof typeof CARD_NAME;
}

// What a kind's `detect` gets: the address the user typed, and one HTTPS request at a time. Probes send no
// credentials; gateways often use certificates that aren't publicly trusted, so they learn what the server is,
// never trust it (connecting still checks the certificate).

/** One HTTPS request's outcome: status, Location header and the start of the body; undefined if it failed. */
export type Probe = (options: {
  host: string;
  port: number;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  headers?: Record<string, string>;
}) => Promise<{ status: number; location: string; body: string } | undefined>;

/** The typed address: its host, its port (443 when none was typed), and whether a port was typed. */
export interface Target {
  host: string;
  port: number;
  explicitPort: boolean;
}

/** Recognises one kind from its server's answers, or undefined. `address` is what to save: with the port, unless it's 443. */
export type Detect = (
  target: Target,
  probe: Probe,
) => Promise<{ address: string; browserSignIn?: boolean } | undefined>;

export const withPort = (host: string, port: number) => (port === 443 ? host : `${host}:${port}`);

/** A one-off run of a VPN image: its program and arguments, each its own word. `env` shows in the host's process list, so never a secret. */
export interface OneOffRun {
  entrypoint: string;
  args: readonly string[];
  env?: Readonly<Record<string, string>>;
}

/** What an action may do on the host: run a one-off container of a VPN image (built first if needed), removed afterwards. */
export interface ActionContext {
  runInImage(
    image: VpnImage,
    run: OneOffRun,
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** An action as the engine calls it: input from IPC, unparsed; output as the implementation returns it, for the form to parse (callAction). */
export type ErasedAction = (input: unknown, context: ActionContext) => Promise<unknown>;

type Implementations<A extends { [N in keyof A]: Action }> = {
  [N in keyof A]: (
    input: z.output<A[N]['input']>,
    context: ActionContext,
  ) => Promise<z.input<A[N]['output']>>;
};

/** One action, implemented: parses its input before running. Its output is parsed once, by the form, so a transforming schema still works. */
const erase =
  <I extends z.ZodType, O extends z.ZodType>(
    action: { input: I; output: O },
    run: (input: z.output<I>, context: ActionContext) => Promise<z.input<O>>,
  ): ErasedAction =>
  async (raw, context) =>
    run(action.input.parse(raw), context);

/**
 * A kind's actions (its kind file's `…_ACTIONS`), implemented. Each parses its input before running, so a call
 * from the window can't reach an implementation with something it didn't declare.
 */
export function implement<A extends { [N in keyof A]: Action }>(
  declared: A,
  implementations: Implementations<A>,
): Readonly<Record<string, ErasedAction>> {
  const erased: Record<string, ErasedAction> = {};

  // Explicit type arguments: inferred from declared[name], TypeScript would settle for Action's own schema types.
  for (const name in declared) {
    erased[name] = erase<A[typeof name]['input'], A[typeof name]['output']>(
      declared[name],
      implementations[name],
    );
  }

  return erased;
}

/** What a launcher can read: its VPN's stored secrets by slot, and the login password (typed for this connect, else remembered). */
export interface LaunchSecrets {
  read: (key: string) => Promise<string | undefined>;
  loginPassword: () => Promise<string | undefined>;
}

/** How to run one kind's client from its saved settings; "needs-password" when the UI has to ask first. */
export type Launcher<V> = (vpn: V, secrets: LaunchSecrets) => Promise<VpnLaunch | 'needs-password'>;

/**
 * One kind's client, as the engine calls it: how to run it, how to recognise its server from an address,
 * and its kind's declared actions, implemented (`implement`). Registered in @repo/vpns's LAUNCHERS.
 */
export interface LauncherEntry<V> {
  launch: Launcher<V>;
  detect?: Detect;
  actions?: Readonly<Record<string, ErasedAction>>;
}
