import { APP_NAME, type Config, type ConnectionStatus, rankVpns } from "@repo/core";
import type { MenuItemConstructorOptions, NativeImage } from "electron";

/** The ids of the VPNs that are on. Only connected ones count, not ones connecting, waiting for the user or failed. */
export const idsOn = (statuses: Record<string, ConnectionStatus>) =>
  Object.entries(statuses)
    .flatMap(([vpnId, status]) => (status.state === "connected" ? [vpnId] : []))
    .toSorted();

/** The names of the VPNs that are on, highest priority first. */
export const namesOn = (ids: readonly string[], config: Pick<Config, "vpns" | "priority">) =>
  rankVpns(config).flatMap((vpn) => (ids.includes(vpn.id) ? [vpn.name] : []));

export const countHeadline = (count: number) => (count === 0 ? "No VPNs on" : count === 1 ? "1 VPN on" : `${count} VPNs on`);

interface MenuParts {
  count: number;
  names: string[];
  /** Marks each VPN that's on. */
  dot: NativeImage;
  /** The quit shortcut to show, where the OS has one. */
  quitShortcut: string | undefined;
  open(): void;
  quit(): void;
}

/** The tray's menu: the VPNs that are on, opening the window, quitting. Each inner list is a section between separators. */
export function trayMenu({ count, names, dot, quitShortcut, open, quit }: MenuParts): MenuItemConstructorOptions[] {
  const sections: MenuItemConstructorOptions[][] = [
    [{ label: countHeadline(count), enabled: false }, ...names.map((name) => ({ label: name, icon: dot, click: open }))],
    [{ label: `Open ${APP_NAME}`, click: open }],
    // Quitting turns every VPN off (main/index.ts), so the item says so.
    [{ label: "Quit and turn off VPNs", ...(quitShortcut ? { accelerator: quitShortcut } : {}), click: quit }],
  ];
  return sections.flatMap((section, index) => (index === 0 ? section : [{ type: "separator" as const }, ...section]));
}
