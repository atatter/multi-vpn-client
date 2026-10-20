import type { ReactNode } from "react";
import { cx, hint, input, label as labelClass, mono } from "../tokens.ts";
import { SavedValue } from "./SavedValue.tsx";

/**
 * One secret slot. Stored values are never shown: the field says it's saved and offers to replace it.
 * `pending`: a typed value (string), a removal (null), or unchanged (undefined).
 */
export function SecretField({
  label,
  stored,
  pending,
  error,
  hint: hintText,
  onChange,
}: {
  label: string;
  stored: boolean;
  pending: string | null | undefined;
  error?: string | undefined;
  hint?: ReactNode;
  onChange: (value: string | undefined) => void;
}) {
  const replacing = typeof pending === "string" || !stored;
  return (
    <div className="mb-3 grid gap-1">
      <span className={labelClass}>{label}</span>
      {replacing ? (
        <input
          type="password"
          aria-label={label}
          className={cx(input(!!error), mono)}
          value={pending ?? ""}
          placeholder={stored ? "Type a new one" : ""}
          autoComplete="off"
          autoFocus={stored}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <SavedValue onReplace={() => onChange("")}>Saved</SavedValue>
      )}
      {error ? <span className="text-[12.5px] text-danger">{error}</span> : hintText ? <span className={hint}>{hintText}</span> : null}
      {stored && typeof pending === "string" && (
        <button type="button" className="justify-self-start text-[13px] font-semibold text-signal" onClick={() => onChange(undefined)}>
          Keep the saved one
        </button>
      )}
    </div>
  );
}
