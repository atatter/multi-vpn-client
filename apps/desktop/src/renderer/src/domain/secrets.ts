import type { SecretChanges } from '@repo/core';

/** Pending secret edits for one VPN: a new value, or null to clear. Saved together with its settings. */
export type PendingSecrets = SecretChanges[string];

/** Slots that are stored after applying pending edits. */
export function slotsAfter(stored: readonly string[], pending: PendingSecrets): string[] {
  const slots = new Set(stored);
  for (const [key, value] of Object.entries(pending)) {
    if (value === null) {
      slots.delete(key);
    } else if (value.trim()) {
      slots.add(key);
    }
  }
  return [...slots];
}
