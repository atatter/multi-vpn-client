import type { ReactNode } from "react";
import { hint, label as labelClass } from "../tokens.ts";
import { Switch } from "./Switch.tsx";

/** A switch with its label and hint on the left. */
export function ToggleRow({
  label,
  hint: hintText,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span>
        <span className={labelClass}>{label}</span>
        {hintText && <span className={hint}>{hintText}</span>}
      </span>
      <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}
