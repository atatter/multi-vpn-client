import { useState } from "react";
import { cx, danger, dangerLink, link, note } from "@repo/ui/tokens.ts";

/** Remove VPN, with a confirmation that says what goes with it. */
export function RemoveVpn({ name, hasSecrets, on, onRemove }: { name: string; hasSecrets: boolean; on: boolean; onRemove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className={dangerLink} onClick={() => setConfirming(true)}>
        Remove VPN
      </button>
    );
  }
  return (
    <div className={cx(note, "bg-chip")}>
      <p className="mb-2.5">
        Remove {name}?{hasSecrets ? " Its saved password and keys go too." : ""}
      </p>
      <div className="flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <button type="button" className={danger} onClick={onRemove}>
          {on ? "Disconnect and remove" : "Remove"}
        </button>
      </div>
    </div>
  );
}
