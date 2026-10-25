import {
  type Detect,
  implement,
  type LauncherEntry,
  type VpnLaunch,
  withPort,
} from '@repo/vpn-sdk/engine';
import { CHECKPOINT_IMAGE } from './container.ts';
import { CHECKPOINT_ACTIONS, type CheckpointLoginType, type CheckpointVpn } from './kind.ts';
import { CHECKPOINT_SYSCTLS } from './sysctl-shim.ts';

/**
 * Check Point Remote Access through snx-rs in its own container image. Settings go in a
 * config file (copied in like every secret, so the password never sits in the container's
 * arguments). snx-rs asks for whatever the gateway wants after the password, such as an SMS
 * code, on its terminal; the container relays those prompts to the app.
 */

/** Settings this app owns: dropped from the Advanced box, so only the app's values reach snx-rs. */
const OWNED = [
  'server-name',
  'login-type',
  'user-name',
  'password',
  'tunnel-type',
  'no-dns',
  'default-route',
];

/** A config value on one line; a newline would start another setting. */
function oneLine(label: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`The ${label} can't contain line breaks.`);
  }

  return value.trim();
}

/** The Advanced box (key=value per line), without the settings the app sets itself. */
const extraSettings = (advanced: string) =>
  advanced
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line && !line.startsWith('#') && !OWNED.includes(line.split('=')[0]?.trim() ?? ''),
    );

/**
 * snx-rs's config file. DNS is left to the container (it reads the pushed servers like the other clients do).
 * All of the container's traffic goes into the tunnel: the host already decided what reaches the container, and
 * gateways that expect "route all traffic" push only a few routes (then e.g. their DNS servers are unreachable).
 */
export function snxConfig(vpn: CheckpointVpn, password: string | undefined): string {
  const lines = [
    'log-level=info',
    ...extraSettings(vpn.advanced),
    `server-name=${oneLine('server', vpn.server)}`,
    `login-type=${oneLine('login type', vpn.loginType)}`,
    ...(vpn.username ? [`user-name=${oneLine('username', vpn.username)}`] : []),
    // snx-rs expects the password base64-encoded, which also keeps any character safe here.
    ...(password === undefined ? [] : [`password=${Buffer.from(password).toString('base64')}`]),
    `tunnel-type=${vpn.tunnel}`,
    'no-dns=true',
    'default-route=true',
  ];
  return `${lines.join('\n')}\n`;
}

/** What snx-rs prints before the URL of a browser (identity provider, e.g. Microsoft Entra ID) sign-in. */
const BROWSER_SIGN_IN = 'For identity provider authentication';

/** Where snx-rs listens for the token the gateway's sign-in page sends (http://localhost:7779/<token>). */
export const SNX_TOKEN_PORT = 7779;

/**
 * Check Point through snx-rs. Without a remembered password, snx-rs asks for whatever the gateway
 * wants (username, password, code) and the container relays it; Entra ID sign-in needs neither.
 */
export function checkpointLaunch(vpn: CheckpointVpn, password: string | undefined): VpnLaunch {
  let browserNext = false;
  return {
    client: 'snx-rs',
    image: CHECKPOINT_IMAGE,
    createFlags: CHECKPOINT_SYSCTLS.flatMap((setting) => ['--sysctl', setting]),
    command: ['snx'],
    files: { 'snx.conf': snxConfig(vpn, password) },
    signInStep: 'Signing in… If Microsoft Authenticator asks, approve it on your phone.',
    readLine: (line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith(BROWSER_SIGN_IN)) {
        browserNext = true;
        return undefined;
      }

      if (browserNext && trimmed) {
        browserNext = false;
        if (/^https:\/\/\S+$/.test(trimmed)) {
          return { signInUrl: trimmed, tokenPort: SNX_TOKEN_PORT };
        }

        return {
          failed: `${vpn.server} sent a browser sign-in address that isn't https: ${trimmed}`,
        };
      }

      const error = /^Error: (.+)$/.exec(trimmed)?.[1];
      if (!error) {
        return undefined;
      }
      if (error === 'Authentication failed') {
        return {
          failed: 'The VPN server rejected the sign-in (username, password, code or approval).',
        };
      }
      if (error === 'Unsupported login type') {
        return {
          failed: `${vpn.server} doesn't offer the login type ${vpn.loginType}. Look up the ones it offers in the VPN's settings.`,
        };
      }

      return { failed: error };
    },
  };
}

/** A line of `snx-rs -m info`: "  [Username and Password with MFA]: vpn_Username_Password_MFA (password, sms)". */
const LOGIN_TYPE_LINE = /^\s*\[(.+)\]: (vpn_\S+) \(([^()]*)\)$/;

export function parseLoginTypes(output: string): CheckpointLoginType[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [, label, id, factors] = LOGIN_TYPE_LINE.exec(line) ?? [];
    if (!label || !id) {
      return [];
    }

    return [
      {
        id,
        label,
        factors: (factors ?? '')
          .split(',')
          .map((factor) => factor.trim())
          .filter(Boolean),
      },
    ];
  });
}

/** Check Point's actions (kind.ts). `loginTypes` only reads the gateway's public information; nothing signs in. */
export const checkpointActions = implement(CHECKPOINT_ACTIONS, {
  loginTypes: async (server, { runInImage }) => {
    const result = await runInImage(CHECKPOINT_IMAGE, {
      entrypoint: 'snx-rs',
      args: ['--mode=info', `--server-name=${server}`],
      env: { LANG: 'en_US.UTF-8' },
    });
    const types = parseLoginTypes(result.stdout);
    if (result.code === 0 && types.length > 0) {
      return types;
    }

    const error = `${result.stderr}\n${result.stdout}`
      .split(/\r?\n/)
      .find((line) => line.startsWith('Error: '));
    throw new Error(
      error
        ? `${server} didn't answer: ${error.slice('Error: '.length)}`
        : `${server} didn't list any login types.`,
    );
  },
});

/** Check Point's ClientHello, as its Remote Access clients (and snx-rs) send it to /clients/. */
const CHECKPOINT_HELLO =
  '(CCCclientRequest :RequestHeader (:id (1) :type (ClientHello) :session_id ()) :RequestData (:client_info (:client_type (TRAC) :client_version (1) :client_support_saml (true))))';

/** A Check Point gateway answers the client hello with a server response. */
export const detectCheckpoint: Detect = async ({ host, port }, probe) => {
  const answer = await probe({
    host,
    port,
    method: 'POST',
    path: '/clients/',
    body: CHECKPOINT_HELLO,
    headers: { 'Content-Type': 'text/plain' },
  });
  return answer?.body.trimStart().startsWith('(CCCserverResponse')
    ? { address: withPort(host, port) }
    : undefined;
};

export const checkpointEngine: LauncherEntry<CheckpointVpn> = {
  // Nothing is required up front: snx-rs asks for what the gateway wants (relayed as prompts), and
  // Microsoft Entra ID sign-in happens in the browser without a username or password.
  launch: async (vpn, secrets) => checkpointLaunch(vpn, await secrets.loginPassword()),
  detect: detectCheckpoint,
  actions: checkpointActions,
};
