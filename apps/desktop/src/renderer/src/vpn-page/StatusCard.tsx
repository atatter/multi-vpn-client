import { routingPlan, type Vpn, vpnAddress } from '@repo/core';
import { connectedIds, onIds } from '../domain/connection.ts';
import { FORMS } from '@repo/vpns/ui';
import { vpnLabel } from '../domain/labels.ts';
import { RowPrompt } from '../prompts/RowPrompt.tsx';
import { useApp } from '../store/app-model.ts';
import { hasRowPrompt, putAbove, standbyWhy, statusOf, switchBlocker, switchLook } from '../store/vpn-status.ts';
import { Switch } from '@repo/ui/controls/Switch.tsx';
import { cx, link, mono, note, primary, TONES } from '@repo/ui/tokens.ts';
import { LastMinute } from './LastMinute.tsx';

/** Its state, its switch, and while connected the last minute of its traffic; failures show the log and a retry. */
export function StatusCard({ vpn, leave }: { vpn: Vpn; leave: (go: () => void) => void }) {
  const app = useApp();
  const connection = app.connections[vpn.id];
  const plan = routingPlan(app.config, onIds(app.connections, app.prompt, app.waiting), connectedIds(app.connections));
  const layer = plan.find((candidate) => candidate.vpnId === vpn.id);
  const status = statusOf(vpn, app, layer);
  const blocker = switchBlocker(vpn, app);
  const connected = connection?.state === 'connected';
  const failed = connection?.state === 'error';
  const { on, tone } = switchLook(vpn.id, app, layer);
  const starvedBy = layer?.starvedBy ? app.config.vpns.find((other) => other.id === layer.starvedBy) : undefined;
  const title = connected ? 'Connected' : failed ? "Couldn't connect" : app.waiting.has(vpn.id) ? 'Waiting to connect' : on ? 'Connecting' : 'Not connected';
  // Off, it names its server, unless something has to be done before it can connect: then it says what.
  const needsSetup = !on && status.tone === 'sodium';

  return (
    <section
      className={cx(
        'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 rounded-[9px] border px-3 py-2.5',
        connected ? 'border-go/35 bg-[color-mix(in_srgb,var(--go)_7%,var(--field))]' : failed ? 'border-danger/35 bg-[color-mix(in_srgb,var(--danger)_6%,var(--field))]' : 'border-rule bg-field',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cx('block text-[13px] leading-snug', on || needsSetup ? TONES[status.tone] : 'text-muted')}>
          {on || needsSetup ? status.text : `${FORMS[vpn.kind].label} · ${vpnAddress(vpn)}`}
        </span>
      </span>
      <Switch
        label={`Connect ${vpnLabel(vpn)}`}
        checked={on}
        disabled={!!blocker}
        title={blocker}
        tone={tone}
        onChange={() => app.toggle(vpn.id)}
      />
      {connected && (
        <div className="col-span-2 mt-2.5 grid gap-2">
          {starvedBy ? (
            <p className={cx(note, 'bg-standby/12')}>
              {standbyWhy(vpn, vpnLabel(starvedBy)).why}{' '}
              <button type="button" className={link} onClick={() => void putAbove(app, vpn.id, starvedBy.id)}>
                {standbyWhy(vpn, vpnLabel(starvedBy)).action}
              </button>
            </p>
          ) : (
            <LastMinute vpnId={vpn.id} onSeeAll={() => leave(() => app.push({ name: 'traffic' }))} />
          )}
        </div>
      )}
      {failed && (
        <div className="col-span-2 mt-1.5 grid gap-2">
          {connection.log.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[13px] text-muted">Connection log · {connection.log.length} lines</summary>
              <pre className={cx(mono, 'mt-1.5 max-h-48 overflow-auto rounded-md bg-chip p-2 text-[11px] leading-relaxed whitespace-pre-wrap select-text')}>{connection.log.join('\n')}</pre>
            </details>
          )}
          <div>
            <button type="button" className={cx(primary, 'px-3 py-[5px] text-[13px]')} onClick={() => void app.connect(vpn.id)}>
              Try again
            </button>
          </div>
        </div>
      )}
      {hasRowPrompt(vpn, app) && (
        <div className="col-span-2 mt-2">
          <RowPrompt vpn={vpn} />
        </div>
      )}
    </section>
  );
}
