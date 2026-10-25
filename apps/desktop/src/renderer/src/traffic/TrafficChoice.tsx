import { followsServerRoutes, RouteRule, type TrafficMode, type Vpn } from '@repo/core';
import { useState } from 'react';
import { FORMS } from '@repo/vpns/ui';
import { IPV6_BLOCKED, TRAFFIC_LABEL, vpnLabel } from '../domain/labels.ts';
import { type ChoiceOption, Choices } from '@repo/ui/controls/Choices.tsx';
import { cx, link, mono } from '@repo/ui/tokens.ts';
import { SitesEditor, type SiteWarnings } from './SitesEditor.tsx';

/**
 * The one routing decision, per VPN. Two choices by default; "All my traffic" sits behind "More choices":
 * it's redundant when the server already sends everything and usually unwanted when it doesn't.
 */
export function TrafficChoice({
  vpn,
  routes,
  onTraffic,
  onRoutes,
  warnings,
}: {
  vpn: Vpn;
  /** The VPN's own sites. */
  routes: readonly RouteRule[];
  onTraffic: (traffic: TrafficMode) => void;
  onRoutes: (routes: RouteRule[]) => void;
  warnings?: SiteWarnings | undefined;
}) {
  const [more, setMore] = useState(vpn.traffic === 'all');
  const [addingExtra, setAddingExtra] = useState(false);
  const server = vpn.serverRoutes;
  const name = vpnLabel(vpn);
  const unknowable = !followsServerRoutes(vpn.kind);

  const extraSites =
    routes.length > 0 || addingExtra ? (
      <div className="mt-1">
        <span className="text-[13px] font-semibold">Also send these through it</span>
        <SitesEditor
          vpn={vpn}
          routes={routes}
          onChange={onRoutes}
          warnings={warnings}
          autoFocus={addingExtra && routes.length === 0}
        />
      </div>
    ) : (
      <button type="button" className={cx(link, 'mt-0.5')} onClick={() => setAddingExtra(true)}>
        + Also send a site the server doesn't
      </button>
    );

  const options: ChoiceOption<TrafficMode>[] = [
    {
      value: 'official',
      title: TRAFFIC_LABEL.official,
      description: officialDescription(vpn, unknowable),
      extra: server && !server.all ? extraSites : undefined,
      disabled: unknowable,
    },
    {
      value: 'sites',
      title: TRAFFIC_LABEL.sites,
      description: 'Nothing else goes through it. Good for one or two internal tools.',
      extra: (
        <SitesEditor
          vpn={vpn}
          routes={routes}
          onChange={onRoutes}
          warnings={warnings}
          autoFocus={routes.length === 0}
        />
      ),
    },
  ];
  if (more) {
    options.push({
      value: 'all',
      title: TRAFFIC_LABEL.all,
      description:
        server && !server.all
          ? `Everything, even though the server only asks for its own network. Your personal browsing goes through ${name} too, and it can be slower or blocked. ${IPV6_BLOCKED}`
          : `Everything goes through it, whatever the server says. ${IPV6_BLOCKED}`,
    });
  }

  return (
    <>
      <Choices
        label={`What goes through ${name}`}
        value={vpn.traffic}
        options={options}
        onChange={onTraffic}
      />
      {!more && (
        <button type="button" className={cx(link, 'mt-2')} onClick={() => setMore(true)}>
          More choices
        </button>
      )}
    </>
  );
}

/** What following the official app means for this VPN, as far as the app knows. */
function officialDescription(vpn: Vpn, unknowable: boolean) {
  const server = vpn.serverRoutes;
  if (unknowable) {
    return (
      <>
        {FORMS[vpn.kind].label} doesn't tell this app what its gateway sends, so choose your sites
        or all your traffic.
      </>
    );
  }
  if (!server) {
    return (
      <>
        Whatever {vpnLabel(vpn)}'s server sends, exactly like the official app. Shown here after the
        first connect.
      </>
    );
  }
  if (server.all) {
    return <>Its server sends all your traffic through it. {IPV6_BLOCKED}</>;
  }
  return (
    <>
      Its server sends only its own network:
      <span className="mt-1.5 flex flex-wrap gap-1">
        {server.cidrs.map((cidr) => (
          <span
            key={cidr}
            className={cx(mono, 'rounded bg-chip px-1.5 py-px text-[11.5px] text-ink')}
          >
            {cidr}
          </span>
        ))}
        {server.cidrs.length === 0 && <span className="text-[12.5px]">nothing yet</span>}
      </span>
    </>
  );
}
