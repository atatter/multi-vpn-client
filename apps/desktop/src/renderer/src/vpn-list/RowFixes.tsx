import type { RouteRule, Vpn } from '@repo/core';
import { shortTarget, vpnLabel } from '../domain/labels.ts';
import { useApp } from '../store/app-model.ts';
import { putAbove, standbyWhy } from '../store/vpn-status.ts';
import { cx, link, primary } from '@repo/ui/tokens.ts';
import { withPinnedRule } from './pin-rule.ts';

/**
 * The one fix a row offers under its status: try a failed VPN again, use a VPN that's on standby instead,
 * or pin back the single site a higher VPN takes from it.
 */
export function RowFixes({
  vpn,
  failed,
  starvedBy,
  lostRule,
}: {
  vpn: Vpn;
  failed: boolean;
  starvedBy: Vpn | undefined;
  lostRule: RouteRule | undefined;
}) {
  const app = useApp();
  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={cx(primary, 'px-3 py-[5px] text-[13px]')}
          onClick={() => void app.connect(vpn.id)}
        >
          Try again
        </button>
        <button
          type="button"
          className={link}
          onClick={() => app.push({ name: 'vpn', vpnId: vpn.id })}
        >
          Settings
        </button>
      </div>
    );
  }
  if (starvedBy) {
    return (
      <button
        type="button"
        className={link}
        onClick={() => void putAbove(app, vpn.id, starvedBy.id)}
      >
        {standbyWhy(vpn, vpnLabel(starvedBy)).action}
      </button>
    );
  }
  if (!lostRule) return null;
  return (
    <button
      type="button"
      className={link}
      title={`Only ${shortTarget(lostRule)}; the order stays the same`}
      onClick={() => void app.save(withPinnedRule(app.config, lostRule))}
    >
      Send it through {vpnLabel(vpn)} instead
    </button>
  );
}
