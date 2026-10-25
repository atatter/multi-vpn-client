import type { ReactNode } from 'react';
import { input } from '../tokens.ts';
import { Field } from './Field.tsx';

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint: hintText,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} hint={hintText}>
      <select
        className={input()}
        value={value}
        // Option values come from `options`, so the cast only restores the type the DOM drops.
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
