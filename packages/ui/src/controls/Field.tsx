import type { ReactNode } from 'react';
import { hint, label as labelClass } from '../tokens.ts';

/** Label above a control, with a hint or (once shown) an error below. */
export function Field({
  label,
  hint: hintText,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 grid min-w-0 gap-1">
      <span className={labelClass}>{label}</span>
      {children}
      {error && <span className="text-[12.5px] text-danger">{error}</span>}
      {!error && hintText ? <span className={hint}>{hintText}</span> : null}
    </label>
  );
}
