import type { ReactNode } from 'react';
import { LockIcon } from '../icons.tsx';

/** A stored value shown as a locked chip with a Replace action. Long values (file names) truncate rather than widen the page. */
export function SavedValue({
  children,
  onReplace,
}: {
  children: ReactNode;
  onReplace: () => void;
}) {
  return (
    <div className="flex h-[34px] min-w-0 items-center justify-between gap-2.5 rounded-[7px] border border-rule bg-chip px-2.5 text-[13px] text-muted">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0">
          <LockIcon />
        </span>
        <span className="min-w-0 truncate">{children}</span>
      </span>
      <button
        type="button"
        className="shrink-0 text-[13px] font-semibold text-signal"
        onClick={onReplace}
      >
        Replace
      </button>
    </div>
  );
}
