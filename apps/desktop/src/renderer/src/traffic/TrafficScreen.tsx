import { vpnLabel } from '../domain/labels.ts';
import { useApp, useTraffic } from '../store/app-model.ts';
import { Frame } from '@repo/ui/Frame.tsx';
import { fmtBytes } from '@repo/ui/format.ts';

/**
 * Everything the VPNs carried in the last five minutes: one row per host and VPN, with how much and through
 * which VPN. Nothing else. Only VPN traffic: the app never sees what uses the normal connection.
 * One grid for the whole list, so the size and VPN columns are only as wide as their widest entry and line up.
 */
export function TrafficScreen() {
  const app = useApp();
  const nameOf = (vpnId: string) =>
    vpnLabel(app.config.vpns.find((vpn) => vpn.id === vpnId) ?? { name: 'Removed VPN' });
  const rows = useTraffic().destinations;
  return (
    <Frame title="Where traffic goes" onBack={app.back}>
      {rows.length === 0 ? (
        <p className="px-[var(--in)] py-3.5 text-[13px] text-muted">
          No VPN traffic in the last 5 minutes.
        </p>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)_max-content_fit-content(40%)]">
          {rows.map((row) => (
            <li
              key={`${row.vpnId} ${row.host}`}
              className="col-span-3 grid grid-cols-subgrid border-b border-rule"
            >
              <button
                type="button"
                className="col-span-3 grid grid-cols-subgrid items-baseline gap-x-3 px-[var(--in)] py-[9px] text-left hover:bg-[color-mix(in_srgb,var(--surface)_94%,var(--ink))]"
                title="Why does it go here?"
                onClick={() => app.push({ name: 'check', query: row.host })}
              >
                <span className="truncate text-sm tabular-nums">{row.host}</span>
                <span className="text-right text-[13px] whitespace-nowrap text-muted tabular-nums">
                  {fmtBytes(row.bytes)}
                </span>
                <span className="truncate text-[13px] font-semibold text-go">
                  {nameOf(row.vpnId)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}
