import { type RouteRule, routeTarget } from "@repo/core";
import { PinIcon, XIcon } from "@repo/ui/icons.tsx";
import { cx, link, mono } from "@repo/ui/tokens.ts";

/** One of a VPN's sites: pinned or paused, a remove button, and a note when a higher VPN wins it. */
export function SiteRow({
  route,
  vpnName,
  winner,
  onUpdate,
  onRemove,
}: {
  route: RouteRule;
  vpnName: string;
  /** The higher VPN that wins this site while both are on, if one does. */
  winner: string | undefined;
  onUpdate: (patch: { enabled?: boolean; pinned?: boolean }) => void;
  onRemove: () => void;
}) {
  const target = routeTarget(route);
  return (
    <li className="flex min-h-[34px] flex-wrap items-center justify-between gap-x-2 border-b border-rule py-[3px] pr-1 pl-2.5 last:border-b-0">
      <span className={cx(mono, "min-w-0 break-all select-text", !route.enabled && "text-muted")}>
        {target}
        {route.pinned && (
          <span className="ml-1.5 font-sans text-[11px] font-semibold text-go" title="Goes through this VPN whatever the order">
            <PinIcon /> pinned
          </span>
        )}
        {!route.enabled && (
          <span className="ml-1.5 font-sans text-[12px]">
            paused ·{" "}
            <button type="button" className={link} onClick={() => onUpdate({ enabled: true })}>
              Resume
            </button>
          </span>
        )}
      </span>
      <button
        type="button"
        className="grid size-[26px] shrink-0 place-items-center rounded-md text-off hover:bg-chip hover:text-danger"
        aria-label={`Remove ${target}`}
        title="Remove"
        onClick={onRemove}
      >
        <XIcon />
      </button>
      {winner && (
        <p className="mb-1 basis-full text-[12.5px] leading-snug text-sodium">
          {winner} also covers this and is higher, so it goes through {winner}.{" "}
          <button type="button" className={cx(link, "text-[12.5px]")} onClick={() => onUpdate({ pinned: true })}>
            Send it through {vpnName} anyway
          </button>
        </p>
      )}
    </li>
  );
}
