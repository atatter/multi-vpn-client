import { type LauncherEntry, type VpnLaunch } from '@repo/vpn-sdk/engine';
import { OPENVPN_IMAGE } from './container.ts';
import { type OpenVpn, parseOpenVpnProfile } from './kind.ts';

/**
 * Directives dropped from the profile and the Advanced box. `log`, `log-append`, `syslog` and `daemon` would move
 * OpenVPN's output (and our markers) away from the container's stdout, or background it so the container exits.
 * The rest run a program: the app's own hooks need --script-security 2, which would also run a profile's, e.g. a
 * shared .ovpn's `tls-verify` sending the password away. `config` could pull in another file past this filter.
 */
const DROPPED = new Set([
  'log',
  'log-append',
  'syslog',
  'daemon',
  'script-security',
  'plugin',
  'config',
  'up',
  'down',
  'ipchange',
  'route-up',
  'route-pre-down',
  'dns-updown',
  'iproute',
  'tls-verify',
  'tls-crypt-v2-verify',
  'auth-user-pass-verify',
  'client-connect',
  'client-crresponse',
  'client-disconnect',
  'learn-address',
]);

/**
 * The words OpenVPN reads from one line, as its option parser does: quotes and backslash escapes resolved, and
 * nothing after a word starting with `#` or `;`.
 */
function wordsOf(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let state: 'start' | 'plain' | '"' | "'" = 'start';
  let escaped = false;
  for (const char of line) {
    if (!escaped && char === '\\' && state !== "'") {
      escaped = true;
      continue;
    }
    const space = /[\s\0]/.test(char);
    if (state === 'start') {
      if (char === '#' || char === ';') {
        break;
      }
      if (!space && !escaped && (char === '"' || char === "'")) {
        state = char;
      } else if (!space) {
        word += char;
        state = 'plain';
      }
    } else {
      const ends =
        state === 'plain' ? space && !escaped : char === state && (state === "'" || !escaped);
      if (ends) {
        words.push(word);
        word = '';
        state = 'start';
      } else {
        word += char;
      }
    }
    escaped = false;
  }
  if (state !== 'start') {
    words.push(word);
  }
  return words;
}

/** The directive OpenVPN acts on for one line: the first word without a leading "--", or the one after `setenv opt`. */
function directiveOf(line: string): string {
  const [first = '', second, third = ''] = wordsOf(line);
  const directive = first.length > 2 && first.startsWith('--') ? first.slice(2) : first;
  return directive === 'setenv' && second === 'opt' ? third : directive;
}

/** The profile plus the VPN's Advanced box, minus the DROPPED directives. */
export function composeProfile(profile: string, extraDirectives: string): string {
  return `${profile}\n${extraDirectives}\n`
    .split('\n')
    .filter((line) => !DROPPED.has(directiveOf(line)))
    .join('\n');
}

/** OpenVPN in the VPN container: the imported profile, plus credentials when the profile asks for them. */
export function openVpnLaunch({
  profile,
  extraDirectives,
  username,
  password,
}: {
  profile: string;
  /** The VPN's Advanced box: extra OpenVPN directives, appended to the profile. */
  extraDirectives: string;
  username: string;
  password: string | undefined;
}): VpnLaunch {
  return {
    client: 'OpenVPN',
    image: OPENVPN_IMAGE,
    command: ['openvpn'],
    files: {
      'profile.ovpn': composeProfile(profile, extraDirectives),
      ...(password === undefined ? {} : { auth: `${username}\n${password}\n` }),
    },
    readLine: (line) =>
      line.includes('AUTH_FAILED')
        ? { failed: 'The VPN server rejected the username or password.' }
        : undefined,
  };
}

/** The imported profile decides whether a password is needed (`auth-user-pass`); without one it connects as is. */
export const openvpnEngine: LauncherEntry<OpenVpn> = {
  launch: async (vpn, secrets) => {
    const profile = await secrets.read('profile');
    if (!profile) {
      throw new Error('Import the .ovpn profile first.');
    }
    const parsed = parseOpenVpnProfile(profile);
    if (!parsed.ok) {
      throw new Error(`The stored .ovpn profile is invalid (${parsed.error}). Import it again.`);
    }
    if (!parsed.needsPassword) {
      return openVpnLaunch({
        profile,
        extraDirectives: vpn.advanced,
        username: vpn.username,
        password: undefined,
      });
    }
    if (!vpn.username) {
      throw new Error("This profile needs a username. Add it in the VPN's settings.");
    }
    const password = await secrets.loginPassword();
    if (password === undefined) {
      return 'needs-password';
    }
    return openVpnLaunch({
      profile,
      extraDirectives: vpn.advanced,
      username: vpn.username,
      password,
    });
  },
};
