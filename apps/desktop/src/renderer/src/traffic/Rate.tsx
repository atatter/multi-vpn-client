import { useTraffic } from "../store/app-model.ts";
import { fmtRate, smoothRate } from "@repo/ui/format.ts";
import { cx } from "@repo/ui/tokens.ts";

/** The current rate, averaged over a few seconds; a dot lights up while traffic flows. Kept out of live regions. */
export function Rate({ vpnId, className }: { vpnId: string; className?: string }) {
  const now = smoothRate(useTraffic().rates[vpnId]);
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted tabular-nums", className)} title="Traffic over the last few seconds">
      <i className={cx("size-1.5 shrink-0 rounded-full", now > 0 ? "bg-go shadow-[0_0_0_3px_color-mix(in_srgb,var(--go)_22%,transparent)]" : "bg-off")} />
      {fmtRate(now)}
    </span>
  );
}
