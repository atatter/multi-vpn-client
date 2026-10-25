import { type ConnectionStatus, kindSpec, missingSecrets, PASSWORD_SLOT, Vpn } from '@repo/core';
import type { ConnectionStatuses } from '../../../shared/ipc-contract.ts';
import { signsInWith } from './kind-copy.ts';

/** Turned on by the user: connecting, connected, waiting for them, or failed (until they turn it off). */
export const isOn = (status: ConnectionStatus | undefined) =>
  status !== undefined && status.state !== 'disconnected';

export const connectedIds = (connections: ConnectionStatuses) =>
  new Set(
    Object.entries(connections).flatMap(([vpnId, status]) =>
      status.state === 'connected' ? [vpnId] : [],
    ),
  );

/** Every VPN that's on as the user sees it: its connection is on, or it's waiting for setup or for the user's answer. */
export const onIds = (
  connections: ConnectionStatuses,
  prompt: { vpnId: string } | undefined,
  waiting: ReadonlySet<string>,
) =>
  new Set([
    ...Object.entries(connections).flatMap(([vpnId, status]) => (isOn(status) ? [vpnId] : [])),
    ...(prompt ? [prompt.vpnId] : []),
    ...waiting,
  ]);

/** Whether it signs in with the login password (asked for on connect unless remembered), not another way such as a card. */
export const usesPassword = (vpn: Vpn) =>
  kindSpec(vpn.kind).secrets.includes(PASSWORD_SLOT) && !signsInWith(vpn);

/** Why a VPN can't connect yet, or undefined if it's ready. */
export function setupProblem(vpn: Vpn, storedSlots: readonly string[]): string | undefined {
  if (!Vpn.safeParse(vpn).success) {
    return 'Finish setting up';
  }
  const [slot] = missingSecrets(vpn, storedSlots);
  if (!slot) {
    return undefined;
  }
  return slot.importOnly ? `Needs the ${slot.label}` : `Needs a ${slot.label.toLowerCase()}`;
}
