import { type Detect, type LauncherEntry, type VpnLaunch, withPort } from '@repo/vpn-sdk/engine';
import { extraArguments, readOpenConnect, REJECTED } from '../../shared/openconnect/engine.ts';
import { OPENCONNECT_IMAGE } from '../../shared/openconnect/container.ts';
import type { FortinetSslVpn } from './kind.ts';

/**
 * FortiGate SSL VPN through OpenConnect's Fortinet mode, which uses a plain tun device (no PPP).
 * Answers: the password, then an empty line for a one-time code if the gateway asks for one.
 * An empty code makes OpenConnect request a FortiToken push instead, approved on your phone.
 */
export function fortinetLaunch(vpn: FortinetSslVpn, password: string): VpnLaunch {
  return {
    client: 'OpenConnect',
    image: OPENCONNECT_IMAGE,
    command: [
      'openconnect',
      '--protocol=fortinet',
      `--user=${vpn.username}`,
      ...(vpn.realm ? [`--usergroup=${vpn.realm}`] : []),
      ...(vpn.serverCertPin ? [`--servercert=${vpn.serverCertPin}`] : []),
      ...extraArguments(vpn.advanced),
      `https://${vpn.gateway}`,
    ],
    files: { auth: `${password}\n\n` },
    readLine: readOpenConnect(vpn.gateway, (line) =>
      line.includes('Invalid credentials') ? REJECTED : undefined,
    ),
  };
}

/** A FortiGate's SSL VPN login page. It often listens on 10443 rather than 443, so without a typed port both are tried. */
export const detectFortinet: Detect = async ({ host, port, explicitPort }, probe) => {
  const looksLikeIt = (text: string) => /\/remote\/(logincheck|login|fgt_lang)/.test(text);
  const ports = explicitPort ? [port] : [443, 10443];
  const found = await Promise.all(
    ports.map(async (candidate) => {
      const answer = await probe({ host, port: candidate, method: 'GET', path: '/remote/login' });
      return answer &&
        ((answer.status === 200 && looksLikeIt(answer.body)) || looksLikeIt(answer.location))
        ? { address: withPort(host, candidate) }
        : undefined;
    }),
  );
  return found.find((result) => result !== undefined);
};

export const fortinetSslEngine: LauncherEntry<FortinetSslVpn> = {
  launch: async (vpn, secrets) => {
    if (!vpn.username) throw new Error("Add your username in the VPN's settings.");
    const password = await secrets.loginPassword();
    if (password === undefined) return 'needs-password';
    return fortinetLaunch(vpn, password);
  },
  detect: detectFortinet,
};
