import {
  type Action,
  bareHosts,
  commonFields,
  defineKind,
  HostPort,
  PASSWORD_SLOT,
  requiredText,
} from '@repo/vpn-sdk';
import { z } from 'zod';

/** A login type a Check Point gateway offers, e.g. { id: "vpn_OTP", label: "MFA", factors: ["password"] }. */
export const CheckpointLoginType = z.object({
  id: z.string(),
  label: z.string(),
  /** What signing in takes, as the gateway lists it: "password", "certificate", "identity_provider"… */
  factors: z.array(z.string()),
});
export type CheckpointLoginType = z.infer<typeof CheckpointLoginType>;

/**
 * Factors the app can't provide: certificates (none are stored yet), and Mobile Access, which needs a
 * password copied out of a web page's source. Browser sign-in ("identity_provider", e.g. Microsoft
 * Entra ID) works: the app opens the page and hands the result to the client.
 */
const UNSUPPORTED_FACTORS = new Set(['certificate', 'mobile_access']);

/** Whether this app can sign in with a login type: passwords and codes (asked for while connecting), or the browser. */
export const canUseLoginType = (type: CheckpointLoginType) =>
  !type.factors.some((factor) => UNSUPPORTED_FACTORS.has(factor));

/** `loginTypes`: what the gateway at `server` ("host" or "host:port") offers. Only reads its public information. */
export const CHECKPOINT_ACTIONS = {
  loginTypes: { input: HostPort, output: z.array(CheckpointLoginType) },
} satisfies Record<string, Action>;

/** Check Point Remote Access through snx-rs. */
export const checkpoint = defineKind(
  z.object({
    ...commonFields,
    kind: z.literal('checkpoint'),
    server: HostPort,
    /** e.g. "vpn_EntraID", as listed by the gateway. */
    loginType: requiredText('Login type'),
    username: z.string(),
    tunnel: z.enum(['ipsec', 'ssl']),
  }),
  {
    create: (c) => ({
      ...c,
      kind: 'checkpoint',
      server: '',
      loginType: '',
      username: '',
      tunnel: 'ipsec',
    }),
    address: (vpn) => vpn.server,
    withAddress: (vpn, server) => ({ ...vpn, server }),
    hosts: (vpn) => bareHosts([vpn.server]),
    secrets: [PASSWORD_SLOT],
    actions: CHECKPOINT_ACTIONS,
    // snx-rs doesn't say what the gateway sends, so "same as the official app" can't apply.
    followsServerRoutes: false,
  },
);

/** A saved Check Point VPN. */
export type CheckpointVpn = z.output<typeof checkpoint.schema>;
