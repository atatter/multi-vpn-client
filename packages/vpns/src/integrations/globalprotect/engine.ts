import {
  CARD_NAME,
  type Detect,
  type Failure,
  type LauncherEntry,
  type ReadLine,
  type VpnLaunch,
  withPort,
} from '@repo/vpn-sdk/engine';
import { OPENCONNECT_CARD_IMAGE, OPENCONNECT_IMAGE } from '../../shared/openconnect/container.ts';
import { extraArguments, readOpenConnect, REJECTED } from '../../shared/openconnect/engine.ts';
import { type GlobalProtectVpn, ID_CARD_CERTIFICATE } from './kind.ts';

/** OpenConnect's --os values for the OS the gateway is told we run. */
const GP_OS = { win: 'win', mac: 'mac-intel', linux: 'linux-64' } as const;

/** GlobalProtect with a password, which goes in on stdin. */
export function globalProtectLaunch(vpn: GlobalProtectVpn, password: string): VpnLaunch {
  const { options, readLine } = globalProtect(vpn, false);
  return {
    client: 'OpenConnect',
    image: OPENCONNECT_IMAGE,
    command: ['openconnect', ...options],
    files: { auth: `${password}\n` },
    readLine,
  };
}

/** GlobalProtect with the certificate on the smart card in the computer's reader; the PIN is asked for while connecting. */
export function globalProtectCardLaunch(vpn: GlobalProtectVpn): VpnLaunch {
  const { options, readLine } = globalProtect(vpn, true);
  // The default certificate is an Estonian ID card's: then only such a card is lent, so its PIN2 and PUK stay guarded.
  const smartCard = vpn.cardCertificate ? 'any-card' : 'id-card';
  return {
    client: 'OpenConnect',
    image: OPENCONNECT_CARD_IMAGE,
    command: ['openconnect-card', vpn.cardCertificate || ID_CARD_CERTIFICATE, ...options],
    files: {},
    smartCard,
    signInStep: `Signing in with your ${CARD_NAME[smartCard]}…`,
    readLine,
  };
}

/**
 * Palo Alto GlobalProtect through OpenConnect's gp mode: the options and output reading both
 * sign-ins share. With a Gateway set, it logs in to that gateway directly; otherwise to the portal
 * (or the address as a gateway, per connectAs), which picks the gateway. OpenConnect selects portal
 * gateways by label and would ask when there are several, so that case fails with the list instead,
 * to put one in the Gateway field.
 *
 * With card sign-in, the certificate on the smart card in the computer's reader (e.g. an Estonian
 * ID card) proves who the user is, through the card bridge (engine: smart-card.ts). The login form still
 * wants a username, which such gateways ignore ("login" unless one is set), and an empty password,
 * given as a form entry so that nothing on stdin can answer the card's PIN prompt instead.
 * OpenConnect asks for the PIN, and the container relays that prompt to the app.
 */
function globalProtect(
  vpn: GlobalProtectVpn,
  card: boolean,
): { options: string[]; readLine: ReadLine } {
  const direct = vpn.gateway !== '';
  const server = direct ? vpn.gateway : vpn.portal;
  /** Gateways the portal listed, as OpenConnect prints them: "  <label> (<address>)". */
  const offered = new Map<string, string>();
  const options = [
    '--protocol=gp',
    `--user=${vpn.username || (card ? 'login' : '')}`,
    ...(card ? ['--form-entry=_login:passwd='] : []),
    `--usergroup=${direct || vpn.connectAs === 'gateway' ? 'gateway' : 'portal'}`,
    `--os=${GP_OS[vpn.reportedOs]}`,
    ...(vpn.hip ? ['--csd-wrapper=/usr/libexec/openconnect/hipreport.sh'] : []),
    ...(vpn.serverCertPin ? [`--servercert=${vpn.serverCertPin}`] : []),
    ...extraArguments(vpn.advanced),
    `https://${server}`,
  ];
  const rejected: Failure = card
    ? { failed: "The VPN server didn't accept the card's certificate." }
    : REJECTED;
  return {
    options,
    readLine: readOpenConnect(server, (line) => {
      const listed = /^ {2}(.+) \(([^()\s]+)\)$/.exec(line);
      if (listed?.[1] && listed[2]) offered.set(listed[1], listed[2]);
      const choices = /GATEWAY: \[([^\]]*)\]:/.exec(line)?.[1];
      if (choices) {
        const gateways = choices
          .split('|')
          .map((label) => (offered.has(label) ? `${label} (${offered.get(label)})` : label));
        return {
          failed: `The portal offers several gateways: ${gateways.join(', ')}. Put the address of the one to use in the Gateway field.`,
        };
      }
      if (
        line.includes('Unexpected 512 result') ||
        /invalid (username|user name) or password/i.test(line)
      )
        return rejected;
      // The server didn't get a certificate it takes. Portals often only take passwords, while their gateways take the card.
      if (line.includes('Valid client certificate is required')) {
        return {
          failed:
            card && !direct && vpn.connectAs === 'portal'
              ? "The portal didn't accept the card. Under More options, set “Connect to the address as” to “Gateway directly”."
              : "The VPN server didn't get a client certificate it accepts.",
        };
      }
      return undefined;
    }),
  };
}

/** A GlobalProtect portal answers its prelogin page; a gateway-only address only the gateway's. */
export const detectGlobalProtect: Detect = async ({ host, port }, probe) => {
  for (const path of ['/global-protect/prelogin.esp', '/ssl-vpn/prelogin.esp']) {
    const answer = await probe({
      host,
      port,
      method: 'POST',
      path: `${path}?tmp=tmp&clientVer=4100&clientos=Windows`,
      headers: { 'User-Agent': 'PAN GlobalProtect' },
    });
    if (answer && /<prelogin-response\b/.test(answer.body))
      return {
        address: withPort(host, port),
        browserSignIn: /<saml-auth-method>/.test(answer.body),
      };
  }
  return undefined;
};

export const globalprotectEngine: LauncherEntry<GlobalProtectVpn> = {
  launch: async (vpn, secrets) => {
    if (vpn.signIn === 'card') return globalProtectCardLaunch(vpn);
    if (!vpn.username) throw new Error("Add your username in the VPN's settings.");
    const password = await secrets.loginPassword();
    if (password === undefined) return 'needs-password';
    return globalProtectLaunch(vpn, password);
  },
  detect: detectGlobalProtect,
};
