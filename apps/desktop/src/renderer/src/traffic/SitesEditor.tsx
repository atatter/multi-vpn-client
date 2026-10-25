import { RouteRule, routeTarget, type Vpn } from '@repo/core';
import { useState } from 'react';
import { vpnLabel } from '../domain/labels.ts';
import { cx, input, link, mono, secondary } from '@repo/ui/tokens.ts';
import { SiteRow } from './SiteRow.tsx';
import { addEntries } from './sites-input.ts';

/** A higher VPN that wins one of these sites while both are on, by rule id. */
export type SiteWarnings = ReadonlyMap<string, { winner: string }>;

/**
 * Add box and list for a VPN's own domains and IP ranges: several at once, remove with undo. A site a
 * higher VPN already covers says so, and offers to pin it here (an exception that wins whatever the order).
 */
export function SitesEditor({
  vpn,
  routes,
  onChange,
  warnings = new Map(),
  autoFocus = false,
}: {
  vpn: Vpn;
  routes: readonly RouteRule[];
  onChange: (routes: RouteRule[]) => void;
  warnings?: SiteWarnings | undefined;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string>();
  const [removed, setRemoved] = useState<{ route: RouteRule; index: number }>();

  const add = () => {
    if (!text.trim()) return;
    const result = addEntries(text, routes, vpn.id);
    if (result.routes.length > routes.length) onChange(result.routes);
    setRemoved(undefined);
    setText(result.text);
    setProblem(result.problem);
  };
  const update = (id: string, patch: { enabled?: boolean; pinned?: boolean }) => onChange(routes.map((route) => (route.id === id ? { ...route, ...patch } : route)));

  return (
    <div className="mt-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className={cx(input(!!problem), mono, 'flex-1')}
          value={text}
          placeholder="jira.example.com or 10.20.0.0/16"
          aria-label="Add a site or IP range"
          spellCheck={false}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className={secondary}>
          Add
        </button>
      </form>
      {problem && <p className="mt-1 text-[12.5px] text-danger select-text">{problem}</p>}
      {removed && (
        <p className="mt-1.5 text-[13px] text-muted">
          Removed {routeTarget(removed.route)}.{' '}
          <button
            type="button"
            className={link}
            onClick={() => {
              onChange([...routes.slice(0, removed.index), removed.route, ...routes.slice(removed.index)]);
              setRemoved(undefined);
            }}
          >
            Undo
          </button>
        </p>
      )}
      {routes.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-rule bg-field">
          {routes.map((route, index) => (
            <SiteRow
              key={route.id}
              route={route}
              vpnName={vpnLabel(vpn)}
              winner={route.enabled && !route.pinned ? warnings.get(route.id)?.winner : undefined}
              onUpdate={(patch) => update(route.id, patch)}
              onRemove={() => {
                setRemoved({ route, index });
                onChange(routes.filter((other) => other.id !== route.id));
              }}
            />
          ))}
        </ul>
      )}
      <span className="mt-1.5 block text-[12.5px] text-muted">Paste links, hosts or IP ranges. Sites include their subdomains.</span>
    </div>
  );
}
