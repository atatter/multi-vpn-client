import { bareHosts, commonFields, defineKind, HostPort, PASSWORD_SLOT } from '@repo/vpn-sdk';
import { z } from 'zod';

/** The authentication certificate of an Estonian ID card (OpenSC's label for it). */
export const ID_CARD_CERTIFICATE = 'pkcs11:object=Isikutuvastus;type=cert';

/** Palo Alto GlobalProtect through OpenConnect: a portal (or a gateway directly), with a password or an ID card. */
export const globalprotect = defineKind(
  z.object({
    ...commonFields,
    kind: z.literal('globalprotect'),
    portal: HostPort,
    /** "" = let the portal pick. */
    gateway: HostPort.or(z.literal('')),
    connectAs: z.enum(['portal', 'gateway']),
    username: z.string(),
    /** OS reported to the gateway; some portals only offer SAML to Windows. */
    reportedOs: z.enum(['win', 'mac', 'linux']),
    hip: z.boolean(),
    /** openconnect --servercert value, e.g. "pin-sha256:…". Added later, hence the default. */
    serverCertPin: z.string().default(''),
    /** "card": with the certificate on a smart card, e.g. an Estonian ID card, instead of a password. Added later, hence the default. */
    signIn: z.enum(['password', 'card']).default('password'),
    /** PKCS#11 URI of the card's certificate; "" = an Estonian ID card's (ID_CARD_CERTIFICATE). */
    cardCertificate: z
      .string()
      .trim()
      .regex(/^(pkcs11:\S+)?$/, 'Expected a PKCS#11 URI, e.g. pkcs11:object=Isikutuvastus;type=cert')
      .default(''),
  }),
  {
    create: (c) => ({
      ...c,
      kind: 'globalprotect',
      portal: '',
      gateway: '',
      connectAs: 'portal',
      username: '',
      reportedOs: 'win',
      hip: false,
      serverCertPin: '',
      signIn: 'password',
      cardCertificate: '',
    }),
    address: (vpn) => vpn.portal,
    withAddress: (vpn, portal) => ({ ...vpn, portal }),
    // The portal and, when set, the gateway it would otherwise pick.
    hosts: (vpn) => bareHosts([vpn.portal, vpn.gateway]),
    secrets: [PASSWORD_SLOT],
    followsServerRoutes: true,
  },
);

/** A saved GlobalProtect VPN. */
export type GlobalProtectVpn = z.output<typeof globalprotect.schema>;
