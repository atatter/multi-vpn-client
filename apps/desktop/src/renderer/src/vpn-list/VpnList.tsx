import { routingPlan } from '@repo/core';
import { useState } from 'react';
import { connectedIds, onIds } from '../domain/connection.ts';
import { vpnLabel } from '../domain/labels.ts';
import { useApp } from '../store/app-model.ts';
import { GripIcon } from '@repo/ui/icons.tsx';
import { cx, link } from '@repo/ui/tokens.ts';
import { priorityAfterMove } from './reorder.ts';
import { useReorder } from './use-reorder.ts';
import { VpnRow } from './VpnRow.tsx';

/**
 * On, highest priority first (position is the priority: when two cover an address, the higher one gets it),
 * then Off. Turned-on rows can be dragged by their grip, or moved with Alt+↑/↓; rows that change section slide.
 */
export function VpnList({ afterNotice }: { afterNotice: boolean }) {
  const app = useApp();
  const { config } = app;
  const on = onIds(app.connections, app.prompt, app.waiting);
  const plan = routingPlan(config, on, connectedIds(app.connections));
  const off = config.vpns.filter((vpn) => !on.has(vpn.id));
  const many = plan.length > 1;
  const [announcement, setAnnouncement] = useState('');

  /** Saves a new order of the turned-on VPNs as the priority, and says where the moved one went. */
  const commit = (ids: string[], moved: string) => {
    const priority = priorityAfterMove(config, ids, moved);
    if (priority.join() === config.priority.join()) return;
    void app.save({ ...config, priority });
    const vpn = config.vpns.find((candidate) => candidate.id === moved);
    if (vpn)
      setAnnouncement(`${vpnLabel(vpn)} moved to ${ids.indexOf(moved) + 1} of ${ids.length}`);
  };
  const { order, list, rowRef, isLifted, onRowKeyDown, grip } = useReorder({
    order: plan.map((layer) => layer.vpnId),
    commit,
  });

  return (
    <div ref={list} className="relative">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {plan.length > 0 && (
        <>
          {/* Right under the setup notice, its own margin is the gap; the heading doesn't add another. */}
          <div
            className={cx(
              'grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-b border-rule px-[var(--in)] pb-[7px]',
              afterNotice ? 'pt-0' : 'pt-3.5',
            )}
          >
            <h2 className="text-[13px] font-semibold text-muted">On</h2>
            <button type="button" className={link} onClick={() => app.push({ name: 'traffic' })}>
              Where traffic goes
            </button>
          </div>
          <ol className="relative bg-bg">
            {order.map((id, index) => {
              const vpn = config.vpns.find((candidate) => candidate.id === id);
              const layer = plan.find((candidate) => candidate.vpnId === id);
              if (!vpn) return null;
              const lifted = isLifted(id);
              return (
                <VpnRow
                  key={id}
                  vpn={vpn}
                  layer={layer}
                  rowRef={rowRef}
                  lifted={lifted}
                  onKeyDown={many ? onRowKeyDown : undefined}
                  grip={
                    many ? (
                      <button
                        type="button"
                        title="Drag, or Alt+↑/↓, to change who wins"
                        aria-label={`${vpnLabel(vpn)}, priority ${index + 1} of ${order.length}. Use the arrow keys to move it.`}
                        className={cx(
                          'grid h-[58px] w-6 touch-none place-items-center self-start rounded-md text-off hover:text-muted',
                          lifted ? 'cursor-grabbing text-muted' : 'cursor-grab',
                        )}
                        data-row-id={id}
                        {...grip}
                      >
                        <GripIcon />
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </ol>
        </>
      )}
      {off.length > 0 && (
        <>
          {/* With nothing on, an "Off" heading has nothing to set it apart from. */}
          {plan.length > 0 && (
            <h2 className="mt-1.5 border-b border-rule px-[var(--in)] pt-3.5 pb-[7px] text-[13px] font-semibold text-muted">
              Off
            </h2>
          )}
          <ol>
            {off.map((vpn) => (
              <VpnRow key={vpn.id} vpn={vpn} layer={undefined} rowRef={rowRef} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
