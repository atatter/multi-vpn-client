import { bareHosts, commonFields, defineKind, HostPort, PASSWORD_SLOT } from '@repo/vpn-sdk';
import { z } from 'zod';

/** FortiGate SSL VPN through OpenConnect, often on port 10443. */
export const fortinetSsl = defineKind(
  z.object({
    ...commonFields,
    kind: z.literal('fortinet-ssl'),
    gateway: HostPort,
    realm: z.string(),
    username: z.string(),
    /** openconnect --servercert value, e.g. "pin-sha256:…". */
    serverCertPin: z.string(),
  }),
  {
    create: (c) => ({
      ...c,
      kind: 'fortinet-ssl',
      gateway: '',
      realm: '',
      username: '',
      serverCertPin: '',
    }),
    address: (vpn) => vpn.gateway,
    withAddress: (vpn, gateway) => ({ ...vpn, gateway }),
    hosts: (vpn) => bareHosts([vpn.gateway]),
    secrets: [PASSWORD_SLOT],
    followsServerRoutes: true,
  },
);

/** A saved Fortinet SSL VPN. */
export type FortinetSslVpn = z.output<typeof fortinetSsl.schema>;
