import { kindSpec, missingSecrets, type RouteRule, Vpn } from '@repo/core';
import { type PendingSecrets, slotsAfter } from './secrets.ts';

import type { FormErrors } from '@repo/vpn-sdk/ui';

// Field errors are keyed by schema path ("portal", "addresses.0") or "secrets.<slot>"; kinds' forms read them too.
export { errorAt, type FormErrors } from '@repo/vpn-sdk/ui';

/** What has to be fixed before saving: schema issues, required secrets that aren't stored or typed, and chosen sites without any. */
export function formErrors(vpn: Vpn, routes: readonly RouteRule[], storedSlots: readonly string[], pending: PendingSecrets): FormErrors {
  const errors: FormErrors = {};
  const parsed = Vpn.safeParse(vpn);
  for (const issue of parsed.success ? [] : parsed.error.issues) errors[issue.path.join('.')] ??= issue.message;
  for (const slot of missingSecrets(vpn, slotsAfter(storedSlots, pending))) {
    errors[`secrets.${slot.key}`] = slot.importOnly ? `Choose the ${slot.label} from your provider.` : `Enter the ${slot.label.toLowerCase()}.`;
  }
  // Settings read from an imported file have no field of their own, so their errors show on the file's.
  for (const slot of kindSpec(vpn.kind).secrets) {
    for (const field of slot.fills ?? []) if (errors[field]) errors[`secrets.${slot.key}`] ??= errors[field];
  }
  if (vpn.traffic === 'sites' && routes.length === 0) errors.sites = 'Add at least one site, or pick another option. Otherwise nothing goes through it.';
  return errors;
}
