import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Vpn } from '@repo/vpns';
import { readJsonIfExists, writeJsonAtomic } from './fs.ts';
import {
  applySecretChanges,
  validateSecretChanges,
  type SecretChanges,
  type SecretMap,
  type SecretStatus,
} from './secrets.ts';
import { defaultConfigPath } from './store.ts';

/**
 * Encrypted secret file next to config.json. Node-only; import via
 * "@repo/core/secret-store". Encryption is injected: the desktop app passes
 * Electron's safeStorage (OS keychain), tests pass a fake. A cipher must throw
 * when it can't encrypt safely; nothing is written then.
 */

export interface Cipher {
  encrypt(plain: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

const SecretFile = z.object({
  version: z.literal(1),
  /** Base64 ciphertext per VPN id, per slot. */
  vpns: z.record(z.string(), z.record(z.string(), z.string())),
});

export const defaultSecretsPath = (configPath = defaultConfigPath()) =>
  join(dirname(configPath), 'secrets.json');

export function createSecretStore(path: string, cipher: Cipher) {
  const readAll = async (): Promise<SecretMap<string>> => {
    const raw = await readJsonIfExists(path);
    return raw === undefined ? {} : SecretFile.parse(raw).vpns;
  };
  // A value this machine's key can't decrypt (the app's name or the OS keychain changed) counts as missing
  // everywhere: the window shows it as not saved and asks for it again, instead of every connect failing.
  const decrypt = (stored: string) =>
    cipher.decrypt(Buffer.from(stored, 'base64')).catch(() => undefined);
  const readableStatus = async (stored: SecretMap<string>): Promise<SecretStatus> => {
    const vpns = await Promise.all(
      Object.entries(stored).map(async ([vpnId, slots]) => {
        const keys = await Promise.all(
          Object.entries(slots).map(async ([key, value]) =>
            (await decrypt(value)) === undefined ? [] : [key],
          ),
        );
        return [vpnId, keys.flat()] as const;
      }),
    );
    return Object.fromEntries(vpns.filter(([, keys]) => keys.length > 0));
  };

  return {
    /** Which slots hold a value this machine can decrypt. */
    async status(): Promise<SecretStatus> {
      return readableStatus(await readAll());
    },

    /** Decrypted value of one slot, for handing to an engine at connect time. Never sent to the UI. */
    async read(vpnId: string, key: string): Promise<string | undefined> {
      const stored = (await readAll())[vpnId]?.[key];
      return stored === undefined ? undefined : decrypt(stored);
    },

    /**
     * Validates and encrypts UI changes without writing anything, so a caller can
     * do this before saving the config. `commit` then writes them and prunes
     * against the saved VPNs (deleted VPNs, changed kinds, passwords no longer remembered).
     */
    async prepare(
      changes: SecretChanges,
      vpns: readonly Vpn[],
    ): Promise<{ commit: () => Promise<SecretStatus> }> {
      const problems = validateSecretChanges(changes, vpns);
      if (problems.length > 0) throw new Error(problems.join('\n'));

      const encrypted: SecretMap<string | null> = {};
      for (const [vpnId, slots] of Object.entries(changes)) {
        const out: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(slots)) {
          out[key] = value === null ? null : (await cipher.encrypt(value)).toString('base64');
        }
        encrypted[vpnId] = out;
      }

      return {
        async commit() {
          const pruned = applySecretChanges(await readAll(), encrypted, vpns);
          await writeJsonAtomic(path, { version: 1, vpns: pruned }, 0o600);
          return readableStatus(pruned);
        },
      };
    },
  };
}
