import { useTraffic } from '../store/app-model.ts';
import { TrafficBars } from '../traffic/TrafficBars.tsx';
import { fmtBytes, fmtRate, smoothRate } from '@repo/ui/format.ts';
import { cx, link } from '@repo/ui/tokens.ts';

/** A connected VPN's last minute: bars, the current rate and the total. The only part of the page that changes every second. */
export function LastMinute({ vpnId, onSeeAll }: { vpnId: string; onSeeAll: () => void }) {
  const rates = useTraffic().rates[vpnId] ?? [];
  return (
    <>
      <TrafficBars rates={rates} />
      <div className="flex items-baseline gap-2.5 tabular-nums">
        <span className="text-[15px] font-semibold whitespace-nowrap">{fmtRate(smoothRate(rates))}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{fmtBytes(rates.reduce((sum, value) => sum + value, 0))} in the last minute</span>
        <button type="button" className={cx(link, 'whitespace-nowrap')} onClick={onSeeAll}>
          See all traffic
        </button>
      </div>
    </>
  );
}
