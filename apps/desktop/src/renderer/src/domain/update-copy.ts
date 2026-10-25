// What the app says about updating, in one place so the window's button, Settings → About and the error strip agree.
import type { ConnectionStatus } from '@repo/core';
import type { UpdateState } from '../../../shared/ipc-contract.ts';
import { isOn } from './connection.ts';

/** What an action does: check and download ask main; restart asks the user first. */
export type UpdateRun = 'check' | 'download' | 'restart';

/** Settings → About's Version row: one short status line and at most one one-word action, in every state. */
export function versionRow(update: UpdateState, now: number): { line: string; failed?: true; action?: { label: string; run: UpdateRun; disabled?: true } } {
  const check = { label: 'Check', run: 'check' } as const;
  switch (update.state) {
    case 'off':
      return { line: 'Dev build, updates are off' };
    case 'idle':
      return { line: 'Checks npm hourly and when you open the window', action: check };
    case 'checking':
      return { line: 'Checking npm…', action: { ...check, disabled: true } };
    case 'current':
      return { line: `Up to date, checked ${ago(now - update.checkedAt)}`, action: check };
    case 'available':
      return { line: `${update.version} is available${update.size ? `, ${Math.round(update.size / 1e6)} MB` : ''}`, action: { label: 'Update', run: 'download' } };
    case 'downloading':
      return { line: `Downloading ${update.version}… ${update.percent}%` };
    case 'ready':
      return { line: `${update.version} is ready. Restart turns VPNs off.`, action: { label: 'Restart', run: 'restart' } };
    case 'restarting':
      return { line: `Restarting to ${update.version}…` };
    case 'check-failed':
      return { line: update.error, failed: true, action: { label: 'Retry', run: 'check' } };
    case 'download-failed':
      return { line: update.error, failed: true, action: { label: 'Retry', run: 'download' } };
  }
}

/** The window's update button: its tooltip, or undefined while there's no update to show it for. */
export function updateTooltip(update: UpdateState): string | undefined {
  switch (update.state) {
    case 'available':
      return `Update ${update.version} ready to download`;
    case 'downloading':
      return `Downloading update (${update.percent}%)`;
    case 'ready':
      return `Restart to update to ${update.version}`;
    case 'restarting':
      return `Restarting to update to ${update.version}`;
    case 'download-failed':
      return `Couldn't download ${update.version}. Click to try again.`;
    default:
      return undefined;
  }
}

/** What the error strip says when a download failed; nothing for other states. */
export const updateNotice = (update: UpdateState) => (update.state === 'download-failed' ? `Couldn't download ${update.version}: ${update.error}` : undefined);

/** The question before restarting into a downloaded version, given how many VPNs are on. */
export function restartQuestion(version: string, on: number) {
  return {
    title: `Restart to update to ${version}?`,
    body: on === 0 ? 'No VPNs are on.' : `This turns off the ${on === 1 ? "VPN that's" : `${on} VPNs that are`} on. Turn ${on === 1 ? 'it' : 'them'} back on after.`,
  };
}

/**
 * What the restart question turns into once the user said Restart: each VPN that was on, as main turns it off, then
 * the new version starting. Main turns them off one at a time, in an order the window doesn't know, so every VPN still
 * on shows as turning off. A failed VPN runs nothing, so main has nothing to turn off and it stays "error": it's off.
 */
export function restartProgress(version: string, vpns: { name: string; status: ConnectionStatus | undefined }[]) {
  const off = (status: ConnectionStatus | undefined) => !isOn(status) || status?.state === 'error';
  const allOff = vpns.every((vpn) => off(vpn.status));
  return {
    title: `Restarting to update to ${version}`,
    body: 'The window closes and opens again by itself.',
    steps: [
      ...vpns.map(({ name, status }) => (off(status) ? { label: `${name} is off`, state: 'done' as const } : { label: `Turning off ${name}…`, state: 'active' as const })),
      allOff ? { label: `Starting ${version}…`, state: 'active' as const } : { label: `Start ${version}`, state: 'todo' as const },
    ],
  };
}

/** "just now", "a minute ago", "5 minutes ago", "an hour ago", "3 hours ago". */
function ago(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
}
