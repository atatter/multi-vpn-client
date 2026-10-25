import type { PlanLayer, Vpn } from '@repo/core';
import type { KeyboardEvent, ReactNode } from 'react';
import { vpnLabel } from '../domain/labels.ts';
import { RowPrompt } from '../prompts/RowPrompt.tsx';
import { useApp } from '../store/app-model.ts';
import { hasRowPrompt, lostOne, statusOf, switchBlocker, switchLook } from '../store/vpn-status.ts';
import { Rate } from '../traffic/Rate.tsx';
import { Switch } from '@repo/ui/controls/Switch.tsx';
import { ChevronIcon } from '@repo/ui/icons.tsx';
import { cx, TONES } from '@repo/ui/tokens.ts';
import { RowFixes } from './RowFixes.tsx';

/** One VPN: name, one status line, a switch; prompts and fixes open underneath. The name area opens its page. */
export function VpnRow({
  vpn,
  layer,
  rowRef,
  grip,
  lifted = false,
  onKeyDown,
}: {
  vpn: Vpn;
  layer: PlanLayer | undefined;
  /** Lets the list find the row to animate and drag it; the row tells it which VPN it is through `data-row-id`. */
  rowRef: (element: HTMLLIElement) => (() => void) | undefined;
  grip?: ReactNode;
  lifted?: boolean;
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
}) {
  const app = useApp();
  const connection = app.connections[vpn.id];
  const status = statusOf(vpn, app, layer);
  const blocker = switchBlocker(vpn, app);
  const prompt = hasRowPrompt(vpn, app);
  const failed = connection?.state === 'error';
  const starvedBy = layer?.starvedBy
    ? app.config.vpns.find((other) => other.id === layer.starvedBy)
    : undefined;
  const lost = layer?.live ? lostOne(layer) : undefined;
  const look = switchLook(vpn.id, app, layer);
  const asking = prompt || failed;

  return (
    <li
      ref={rowRef}
      data-row-id={vpn.id}
      onKeyDown={onKeyDown}
      className={cx(
        'relative grid min-h-[58px] items-center border-b border-rule pr-[var(--in)]',
        grip
          ? 'grid-cols-[auto_1fr_auto] pl-[calc(var(--in)-6px)]'
          : 'grid-cols-[1fr_auto] pl-[var(--in)]',
        starvedBy ? 'bg-[color-mix(in_srgb,var(--standby)_8%,var(--surface))]' : 'bg-surface',
        lifted
          ? 'z-10 rounded-lg border-b-transparent shadow-lifted'
          : !asking && 'hover:bg-[color-mix(in_srgb,var(--surface)_94%,var(--ink))]',
        'group',
      )}
    >
      {grip}
      <button
        type="button"
        className="grid min-w-0 gap-px py-2.5 pr-3 text-left"
        title={`${vpnLabel(vpn)} settings`}
        onClick={() => app.push({ name: 'vpn', vpnId: vpn.id })}
      >
        <span className="flex min-w-0 items-center gap-1.5 font-semibold">
          <span className="truncate">{vpnLabel(vpn)}</span>
          <span className="shrink-0 text-muted opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
            <ChevronIcon />
          </span>
        </span>
        <span
          className={cx(
            'text-[13px]',
            TONES[status.tone],
            status.wrap ? 'leading-snug' : 'truncate',
          )}
        >
          {/* Only the words are announced; the rate changes every second. */}
          <span aria-live="polite">
            {status.scope && <b className="font-semibold text-ink">{status.scope}</b>}
            {status.text}
          </span>
          {status.rate && <Rate vpnId={vpn.id} className="ml-1.5" />}
        </span>
      </button>
      <Switch
        label={vpnLabel(vpn)}
        checked={look.on}
        disabled={!!blocker}
        title={blocker}
        tone={look.tone}
        onChange={() => app.toggle(vpn.id)}
      />
      {(prompt || failed || starvedBy || lost) && (
        <div
          className={cx(
            'pb-3.5 animate-[rise_160ms_ease-out]',
            grip ? 'col-start-2 col-end-4' : 'col-span-2',
          )}
        >
          {prompt && <RowPrompt vpn={vpn} />}
          <RowFixes vpn={vpn} failed={failed} starvedBy={starvedBy} lostRule={lost?.rule} />
        </div>
      )}
    </li>
  );
}
