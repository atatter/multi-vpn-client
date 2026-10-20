import type { Vpn } from "@repo/core";
import { useState } from "react";
import { setupProblem } from "../domain/connection.ts";
import type { FormErrors } from "../domain/form-errors.ts";
import { type PendingSecrets, slotsAfter } from "../domain/secrets.ts";
import { accountSummary, advancedSummary } from "../domain/summaries.ts";
import { Fold } from "@repo/ui/controls/Fold.tsx";
import { AccountFields } from "../vpn-form/AccountFields.tsx";
import { AdvancedFields } from "../vpn-form/AdvancedFields.tsx";

/** Account and Advanced, folded to a one-line summary. A folded section with a problem opens itself, so nothing that blocks connecting is hidden. */
export function VpnFolds({
  draft,
  onChange,
  pending,
  onPendingChange,
  storedSlots,
  errors,
  keychainProblem,
}: {
  draft: Vpn;
  onChange: (vpn: Vpn) => void;
  pending: PendingSecrets;
  onPendingChange: (pending: PendingSecrets) => void;
  storedSlots: readonly string[];
  /** Shown errors: empty until the user has tried to save. */
  errors: FormErrors;
  keychainProblem: string | undefined;
}) {
  const [folds, setFolds] = useState({ account: false, advanced: false });
  // Open while it has an error, or lacks something connecting needs (a profile, a key): the status says so above.
  const accountOpen = folds.account || Object.keys(errors).some((key) => key !== "sites" && !key.startsWith("dns")) || !!setupProblem(draft, slotsAfter(storedSlots, pending));
  const advanced = advancedSummary(draft);
  return (
    <div className="mt-[18px]">
      <Fold title="Account" summary={accountSummary(draft)} open={accountOpen} onToggle={() => setFolds({ ...folds, account: !accountOpen })}>
        <AccountFields vpn={draft} onChange={onChange} pending={pending} onPendingChange={onPendingChange} storedSlots={storedSlots} errors={errors} keychainProblem={keychainProblem} showName />
      </Fold>
      <Fold
        title="Advanced"
        summary={advanced.length ? advanced.join(", ") : "Nothing changed"}
        changed={advanced.length > 0}
        open={folds.advanced}
        onToggle={() => setFolds({ ...folds, advanced: !folds.advanced })}
      >
        <AdvancedFields vpn={draft} onChange={onChange} errors={errors} />
      </Fold>
    </div>
  );
}
