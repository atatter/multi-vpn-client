import { changesForSave, Config, keepServerRoutes, SecretChanges } from '@repo/core';
import type { createSecretStore } from '@repo/core/secret-store';
import { loadConfig, saveConfig } from '@repo/core/store';
import type { ConnectionManager } from '@repo/engine';
import type { SaveResult } from '../../shared/ipc-contract.ts';
import { writingConfig } from '../config-writes.ts';
import { keychainProblem } from '../secrets.ts';
import { handle } from './handle.ts';

const failed = (issues: { path: string; message: string }[]): SaveResult => ({ ok: false, issues });
/** Flattens schema issues (zod's shape) for display, e.g. "vpns.0.portal". */
const issuesOf = (
  { issues }: { issues: readonly { path: readonly PropertyKey[]; message: string }[] },
  prefix?: string,
) =>
  issues.map(({ path, message }) => ({
    path: [...(prefix ? [prefix] : []), ...path.map(String)].join('.'),
    message,
  }));

/** Loading and saving the settings file and the secrets that go with it. */
export function registerConfigHandlers({
  configPath,
  secrets,
  connections,
  onSaved,
}: {
  configPath: string;
  secrets: ReturnType<typeof createSecretStore>;
  connections: ConnectionManager;
  /** Gets the config each time the user saves settings, the only write that changes names or priority (for the tray's menu). */
  onSaved: (config: Config) => void;
}) {
  handle('config:load', async () => {
    const [config, secretStatus, problem] = await Promise.all([
      loadConfig(configPath),
      secrets.status(),
      keychainProblem(),
    ]);
    return { path: configPath, config, secretStatus, keychainProblem: problem };
  });

  handle('config:save', (configInput, secretsInput) =>
    writingConfig(async (): Promise<SaveResult> => {
      const config = Config.safeParse(configInput);
      if (!config.success) {
        return failed(issuesOf(config.error));
      }
      const changes = SecretChanges.safeParse(secretsInput);
      if (!changes.success) {
        return failed(issuesOf(changes.error, 'secrets'));
      }

      // A VPN whose kind changed loses its old secrets, whatever the renderer sent; the user's own new values win per slot.
      const previous = await loadConfig(configPath);
      config.data.vpns = keepServerRoutes(previous.vpns, config.data.vpns);
      const merged = changesForSave(previous.vpns, config.data.vpns, changes.data);

      // Validate and encrypt secrets first: if the keychain or a value is rejected, nothing has been written.
      let pending: Awaited<ReturnType<typeof secrets.prepare>>;
      try {
        pending = await secrets.prepare(merged, config.data.vpns);
      } catch (error) {
        return failed([
          { path: 'secrets', message: error instanceof Error ? error.message : String(error) },
        ]);
      }
      const saved = await saveConfig(config.data, configPath);
      const secretStatus = await pending.commit();
      void connections.refresh(); // connected VPNs pick up changed routes
      onSaved(saved);
      return { ok: true, config: saved, secretStatus };
    }),
  );
}
