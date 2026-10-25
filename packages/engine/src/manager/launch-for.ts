import { PASSWORD_SLOT, type Vpn, type VpnKind, type VpnOf } from '@repo/core';
import type { ErasedAction, LauncherEntry, VpnLaunch } from '@repo/vpn-sdk/engine';
import { LAUNCHERS } from '@repo/vpns/engine';

/** A kind's entry, typed for that kind's VPN; call it with the VPN's own kind (like core's kindSpec). */
const entryOf = <K extends VpnKind>(kind: K): LauncherEntry<VpnOf<K>> => LAUNCHERS[kind];

/**
 * How to run this VPN's client, from its saved settings and secrets (`readSecret`). A password typed for
 * this connect wins over a remembered one; without either, the UI has to ask.
 */
export async function launchFor(
  vpn: Vpn,
  password: string | undefined,
  readSecret: (vpnId: string, key: string) => Promise<string | undefined>,
): Promise<VpnLaunch | 'needs-password'> {
  return entryOf(vpn.kind).launch(vpn, {
    read: (key) => readSecret(vpn.id, key),
    loginPassword: async () => password ?? (vpn.rememberPassword ? await readSecret(vpn.id, PASSWORD_SLOT.key) : undefined),
  });
}

/** A kind's implemented action by name, or undefined: names come from the window, so only own entries count. */
export function actionOf(kind: VpnKind, name: string): ErasedAction | undefined {
  const { actions } = LAUNCHERS[kind];
  return actions && Object.hasOwn(actions, name) ? actions[name] : undefined;
}
