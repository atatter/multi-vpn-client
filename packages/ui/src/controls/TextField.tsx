import type { ReactNode } from "react";
import { cx, input, mono } from "../tokens.ts";
import { Field } from "./Field.tsx";

export function TextField({
  label,
  value,
  onChange,
  error,
  hint: hintText,
  placeholder = "",
  monospace = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  placeholder?: string;
  monospace?: boolean;
}) {
  return (
    <Field label={label} hint={hintText} error={error}>
      <input
        className={cx(input(!!error), monospace && mono)}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
