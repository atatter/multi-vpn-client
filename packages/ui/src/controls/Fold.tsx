import type { ReactNode } from "react";
import { ChevronIcon } from "../icons.tsx";
import { cx } from "../tokens.ts";

/** A folded section whose summary line says what's set, so nothing customised is hidden. */
export function Fold({ title, summary, changed = false, open, onToggle, children }: { title: string; summary: string; changed?: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-t border-rule">
      <button type="button" aria-expanded={open} className="grid w-full grid-cols-[14px_1fr] items-center gap-x-1.5 pt-3 pb-2.5 text-left" onClick={onToggle}>
        <ChevronIcon className={cx("text-muted transition-transform duration-150", open && "rotate-90")} />
        <span className="font-semibold">{title}</span>
        {!open && <span className={cx("col-start-2 truncate text-[13px]", changed ? "text-signal" : "text-muted")}>{summary}</span>}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </section>
  );
}
