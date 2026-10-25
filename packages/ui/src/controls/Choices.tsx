import type { ReactNode } from 'react';
import { cx } from '../tokens.ts';

export interface ChoiceOption<T extends string> {
  value: T;
  title: string;
  description?: ReactNode;
  /** Shown under the card while it's chosen, e.g. the list of sites. */
  extra?: ReactNode;
  disabled?: boolean;
}

/** One choice out of a few, as cards with a title, a description and (when chosen) extra content. */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="overflow-hidden rounded-[10px] border border-rule bg-field"
    >
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <div key={option.value} className="border-b border-rule last:border-b-0">
            <button
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={option.disabled}
              className="grid w-full grid-cols-[18px_1fr] gap-2.5 px-3 py-2.5 text-left hover:bg-[color-mix(in_srgb,var(--field)_96%,var(--ink))] disabled:cursor-not-allowed disabled:opacity-55"
              onClick={() => onChange(option.value)}
            >
              <span
                className={cx(
                  'relative mt-px size-[18px] rounded-full border-2',
                  chosen
                    ? 'border-signal after:absolute after:inset-[3px] after:rounded-full after:bg-signal'
                    : 'border-track',
                )}
              />
              <span className="min-w-0">
                <span className="block font-semibold">{option.title}</span>
                {option.description && (
                  <span className="mt-px block text-[13px] leading-snug text-muted">
                    {option.description}
                  </span>
                )}
              </span>
            </button>
            {chosen && option.extra && <div className="pr-3 pb-3 pl-[40px]">{option.extra}</div>}
          </div>
        );
      })}
    </div>
  );
}
