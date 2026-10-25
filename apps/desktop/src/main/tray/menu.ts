import { APP_NAME, type Config, type ConnectionStatus, rankVpns } from '@repo/core';
import type { MenuItemConstructorOptions, NativeImage } from 'electron';
import type { UpdateState } from '../../shared/ipc-contract.ts';

/** The ids of the VPNs that are on. Only connected ones count, not ones connecting, waiting for the user or failed. */
export const idsOn = (statuses: Record<string, ConnectionStatus>) =>
  Object.entries(statuses)
    .flatMap(([vpnId, status]) => (status.state === 'connected' ? [vpnId] : []))
    .toSorted();

/** The names of the VPNs that are on, highest priority first. */
export const namesOn = (ids: readonly string[], config: Pick<Config, 'vpns' | 'priority'>) =>
  rankVpns(config).flatMap((vpn) => (ids.includes(vpn.id) ? [vpn.name] : []));

export const countHeadline = (count: number) => {
  if (count === 0) {
    return 'No VPNs on';
  }

  return count === 1 ? '1 VPN on' : `${count} VPNs on`;
};

/**
 * The update's one menu item; undefined whenever the window's update button is hidden too (renderer/src/domain/update-copy.ts).
 * Its wording follows that button's tooltip.
 */
export function updateItem(
  update: UpdateState,
  actions: { download(): void; restart(): void },
): MenuItemConstructorOptions | undefined {
  switch (update.state) {
    case 'available':
      return {
        label: `Update to ${update.version}${update.size ? ` (${Math.round(update.size / 1e6)} MB)` : ''}`,
        click: actions.download,
      };
    case 'downloading':
      return { label: `Downloading ${update.version}… ${update.percent}%`, enabled: false };
    case 'download-failed':
      return { label: `Couldn't download ${update.version}. Try again`, click: actions.download };
    case 'ready':
      return { label: `Restart to update to ${update.version}`, click: actions.restart };
    case 'restarting':
      return { label: `Restarting to update to ${update.version}…`, enabled: false };
    default:
      return undefined;
  }
}

interface MenuParts {
  count: number;
  names: string[];
  /** Marks each VPN that's on. */
  dot: NativeImage;
  /** The update's item, while there is one. */
  update: MenuItemConstructorOptions | undefined;
  /** The quit shortcut to show, where the OS has one. */
  quitShortcut: string | undefined;
  open(): void;
  quit(): void;
}

/**
 * The tray's menu: the VPNs that are on, the update, opening the window, quitting. Each inner list is a section between
 * separators.
 */
export function trayMenu({
  count,
  names,
  dot,
  update,
  quitShortcut,
  open,
  quit,
}: MenuParts): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = [
    [
      { label: countHeadline(count), enabled: false },
      ...names.map((name) => ({ label: name, icon: dot, click: open })),
    ],
    ...(update ? [[update]] : []),
    [{ label: `Open ${APP_NAME}`, click: open }],
    // Quitting turns every VPN off (main/index.ts), so the item says so.
    [
      {
        label: 'Quit and turn off VPNs',
        ...(quitShortcut ? { accelerator: quitShortcut } : {}),
        click: quit,
      },
    ],
  ];
  return sections.flatMap((section, index) =>
    index === 0 ? section : [{ type: 'separator' as const }, ...section],
  );
}
