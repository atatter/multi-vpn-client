import { isBroad, type RouteRule, type TrafficMode, type Vpn } from '@repo/core';
import { TrafficChoice } from '../traffic/TrafficChoice.tsx';
import { heading } from '@repo/ui/tokens.ts';

/** What goes through the VPN, and what changing it between all traffic and its own network will do while it's connected. */
export function TrafficSection({
  saved,
  draft,
  routes,
  warnings,
  error,
  connected,
  onTraffic,
  onRoutes,
}: {
  saved: Vpn;
  draft: Vpn;
  routes: readonly RouteRule[];
  warnings: ReadonlyMap<string, { winner: string }>;
  error: string | undefined;
  connected: boolean;
  onTraffic: (traffic: TrafficMode) => void;
  onRoutes: (routes: RouteRule[]) => void;
}) {
  return (
    <section className="mt-[18px]">
      <h2 className={heading}>What goes through it?</h2>
      <TrafficChoice
        vpn={draft}
        routes={routes}
        onTraffic={onTraffic}
        onRoutes={onRoutes}
        warnings={warnings}
      />
      {error && <span className="mt-1.5 block text-[12.5px] text-danger">{error}</span>}
      {connected && isBroad(draft) !== isBroad(saved) && (
        <p className="mt-2 text-[12.5px] text-muted">
          {isBroad(draft)
            ? "It'll carry all traffic. If another VPN that carries everything is on too, the higher one gets it and the other waits unused."
            : "It'll stop carrying everything else, which goes back to your normal connection."}
        </p>
      )}
    </section>
  );
}
