import type { ServerRoutes } from '@repo/core';
import { loadConfig, saveConfig } from '@repo/core/store';
import { broadcast } from './broadcast.ts';

/**
 * Config writes run one at a time: each loads, changes and saves the file, so two at once (the user saving
 * while a connect records what its server sent) would lose one of them.
 */
let configWrites: Promise<unknown> = Promise.resolve();
export function writingConfig<T>(write: () => Promise<T>): Promise<T> {
  const next = configWrites.then(write, write);
  configWrites = next.catch(() => undefined);
  return next;
}

/** Saves what a VPN's server sent on connect, and tells the window: "same as the official app" depends on it. */
export const saveServerRoutes = (configPath: string, vpnId: string, serverRoutes: ServerRoutes) =>
  writingConfig(async () => {
    const config = await loadConfig(configPath);
    const saved = await saveConfig(
      {
        ...config,
        vpns: config.vpns.map((vpn) => (vpn.id === vpnId ? { ...vpn, serverRoutes } : vpn)),
      },
      configPath,
    );
    broadcast('config:changed', saved);
  });
