import type { Cipher } from '@repo/core/secret-store';
import { safeStorage } from 'electron';

/** Why secrets can't be stored safely here, or undefined if they can. */
export async function keychainProblem(): Promise<string | undefined> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return 'The OS keychain is not available.';
  // Without a secret service, Electron on Linux falls back to a hardcoded key: that's obfuscation, not encryption.
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    return 'No secret service (GNOME Keyring or KWallet) is running.';
  }
  return undefined;
}

/** Encrypts with the OS keychain (DPAPI on Windows, Keychain on macOS, libsecret/KWallet on Linux), or refuses. */
export const keychain: Cipher = {
  async encrypt(plain) {
    const problem = await keychainProblem();
    if (problem) throw new Error(`${problem} Secrets can't be stored safely.`);
    return safeStorage.encryptStringAsync(plain);
  },
  // shouldReEncrypt (key rotation) is ignored for now; the old ciphertext stays readable.
  decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
};
