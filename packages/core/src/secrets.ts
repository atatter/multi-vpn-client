import { z } from 'zod';
import type { SecretSlot } from '@repo/vpn-sdk';
import { kindSpec, type Vpn } from '@repo/vpns';

/**
 * The rules for keeping each VPN kind's secrets (its slots are in its kind.ts, @repo/vpns). Pure and
 * browser-safe; the encrypted file store is in "@repo/core/secret-store".
 *
 * Secret values never travel back to the UI. The UI only learns which slots
 * are set, and sends changes (new value, or null to clear) on save.
 */

/** Which slots are stored, per VPN id. The only view of secrets the UI ever gets. */
export type SecretStatus = Record<string, string[]>;

/** Per VPN id, per slot key. Values are whatever the store keeps (ciphertext on disk). */
export type SecretMap<T> = Record<string, Record<string, T>>;

/** Pending edits from the UI, per VPN id and slot: a new value, or null to clear. */
export const SecretChanges = z.record(z.string(), z.record(z.string(), z.string().nullable()));
export type SecretChanges = z.infer<typeof SecretChanges>;

/** Whether a slot is kept for this VPN: setup secrets always, passwords only when remembered. */
export const isSlotKept = (vpn: Vpn, slot: SecretSlot) => slot.storage === 'always' || vpn.rememberPassword;

const allowed = (vpn: Vpn, key: string) => kindSpec(vpn.kind).secrets.some((slot) => slot.key === key && isSlotKept(vpn, slot));

/** Drops secrets of deleted VPNs, slots the VPN's kind doesn't have, and passwords the user doesn't want kept. */
export function pruneSecrets<T>(stored: SecretMap<T>, vpns: readonly Vpn[]): SecretMap<T> {
  const result: SecretMap<T> = {};
  for (const vpn of vpns) {
    const kept = Object.entries(stored[vpn.id] ?? {}).filter(([key]) => allowed(vpn, key));
    if (kept.length > 0) result[vpn.id] = Object.fromEntries(kept);
  }
  return result;
}

/**
 * Clears every slot of the old kind for a VPN whose kind changed since `saved`: pruning keeps only those slots, so
 * nothing else can be stored. Kinds share slot names (e.g. "password"), so pruning alone would carry an old secret
 * over to a different server.
 */
export function kindChangeClears(saved: readonly Vpn[], next: readonly Vpn[]): SecretChanges {
  const clears: SecretChanges = {};
  for (const vpn of next) {
    const before = saved.find((candidate) => candidate.id === vpn.id);
    if (before && before.kind !== vpn.kind) clears[vpn.id] = Object.fromEntries(kindSpec(before.kind).secrets.map((slot) => [slot.key, null]));
  }
  return clears;
}

/** What a save changes: the user's changes, plus clearing every slot of a VPN whose kind changed. The user's new values win per slot. */
export function changesForSave(saved: readonly Vpn[], next: readonly Vpn[], changes: SecretChanges): SecretChanges {
  const merged: SecretChanges = { ...kindChangeClears(saved, next) };
  for (const [vpnId, slots] of Object.entries(changes)) merged[vpnId] = { ...merged[vpnId], ...slots };
  return merged;
}

/** Stored secrets after `changes` (a value, or null to clear), pruned against the saved VPNs. */
export function applySecretChanges<T>(stored: SecretMap<T>, changes: SecretMap<T | null>, vpns: readonly Vpn[]): SecretMap<T> {
  const next: SecretMap<T> = { ...stored };
  for (const [vpnId, slots] of Object.entries(changes)) {
    const kept = { ...next[vpnId] };
    for (const [key, value] of Object.entries(slots)) {
      if (value === null) delete kept[key];
      else kept[key] = value;
    }
    next[vpnId] = kept;
  }
  return pruneSecrets(next, vpns);
}

/** Which slots are stored, without their values. */
export const secretStatusOf = <T>(stored: SecretMap<T>): SecretStatus =>
  Object.fromEntries(Object.entries(stored).map(([vpnId, slots]) => [vpnId, Object.keys(slots)]));

/** Required slots that aren't stored yet. */
export const missingSecrets = (vpn: Vpn, storedKeys: readonly string[]): SecretSlot[] =>
  kindSpec(vpn.kind).secrets.filter((slot) => slot.required && !storedKeys.includes(slot.key));

/** Checks pending changes against the VPNs they target. Returns human-readable problems; empty means valid. */
export function validateSecretChanges(changes: SecretChanges, vpns: readonly Vpn[]): string[] {
  const problems: string[] = [];
  for (const [vpnId, slots] of Object.entries(changes)) {
    const vpn = vpns.find((candidate) => candidate.id === vpnId);
    if (!vpn) {
      problems.push(`Unknown VPN "${vpnId}"`);
      continue;
    }
    for (const [key, value] of Object.entries(slots)) {
      // Clearing is always fine, including slots of a kind the VPN just switched away from.
      if (value === null) continue;
      const slot = kindSpec(vpn.kind).secrets.find((candidate) => candidate.key === key);
      if (!slot) {
        problems.push(`${vpn.name}: "${key}" is not a secret of this VPN type`);
        continue;
      }
      const parsed = slot.schema.safeParse(value);
      if (!parsed.success) problems.push(`${vpn.name}: ${slot.label}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    }
  }
  return problems;
}
