export const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

const focusRing = 'focus:border-signal focus:outline-none focus:ring-3 focus:ring-signal/20';

/** Text input or select; `invalid` swaps the border instead of stacking conflicting classes. */
export const input = (invalid = false) =>
  cx('h-[34px] w-full rounded-[7px] border bg-field px-2.5 text-sm text-ink select-text', focusRing, invalid ? 'border-danger' : 'border-rule-strong');

export const mono = 'font-mono text-[12.5px]';

const buttonBase = 'shrink-0 rounded-[7px] px-4 py-[7px] text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';

export const primary = cx(buttonBase, 'bg-signal text-on-signal');

export const secondary = cx(buttonBase, 'bg-chip text-ink');

export const danger = cx(buttonBase, 'bg-danger text-on-signal');

export const link = 'text-[13px] font-semibold text-signal disabled:cursor-not-allowed disabled:opacity-40';

export const dangerLink = 'text-sm font-semibold text-danger disabled:cursor-not-allowed disabled:opacity-40';

export const iconButton =
  'grid size-[30px] shrink-0 place-items-center rounded-[7px] text-muted hover:bg-rule hover:text-ink [-webkit-app-region:no-drag]';

export const hint = 'block text-[12.5px] text-muted [overflow-wrap:anywhere]';

export const label = 'text-[13px] font-semibold';

export const groupTitle = 'mb-2 text-[13px] font-semibold text-muted';

/** A section heading inside a screen, e.g. "What goes through Client B?". */
export const heading = 'mb-2 text-[15px] font-semibold';

/** Grouped list (settings, type picker): a bordered box of rows. */
export const cells = 'overflow-hidden rounded-[9px] border border-rule bg-field';

export const cell = 'flex min-h-11 w-full items-center justify-between gap-3 border-b border-rule px-3 py-2 text-left last:border-b-0';

/** Sticky bar under a form with its status and main action. */
export const actionBar = 'flex min-h-[52px] items-center justify-between gap-3 border-t border-rule bg-bg px-3.5 py-2 text-[13px] text-muted';

export const note = 'rounded-lg px-[11px] py-[9px] text-[13px] [overflow-wrap:anywhere]';

/** Text colour per status tone (see store/vpn-status.ts). */
export const TONES = { muted: 'text-muted', go: 'text-go', sodium: 'text-sodium', danger: 'text-danger', standby: 'text-standby' } as const;
