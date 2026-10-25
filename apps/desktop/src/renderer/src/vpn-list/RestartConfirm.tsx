import { useState } from 'react';
import { onIds } from '../domain/connection.ts';
import { vpnLabel } from '../domain/labels.ts';
import { restartProgress, restartQuestion } from '../domain/update-copy.ts';
import { useApp } from '../store/app-model.ts';
import { cx, link, primary } from '@repo/ui/tokens.ts';

const STEP_MARK = {
  done: <span className="text-go">✓</span>,
  active: (
    <span className="size-3 animate-spin rounded-full border-2 border-rule-strong border-t-sodium" />
  ),
  todo: <span className="size-1.5 rounded-full bg-rule-strong" />,
};

/**
 * The question before restarting into a downloaded version: it turns every VPN off. Once answered, it shows each VPN
 * turning off until the window closes. Callers place it, and keep it while the update is ready or restarting.
 */
export function RestartConfirm({ version, onCancel }: { version: string; onCancel: () => void }) {
  const app = useApp();
  // The VPNs that were on when the user said Restart; they turn off one by one after that.
  const [wereOn, setWereOn] = useState<ReadonlySet<string>>();
  const on = onIds(app.connections, app.prompt, app.waiting);

  if (wereOn && app.update.state === 'restarting') {
    const vpns = app.config.vpns
      .filter((vpn) => wereOn.has(vpn.id))
      .map((vpn) => ({ name: vpnLabel(vpn), status: app.connections[vpn.id] }));
    const { title, body, steps } = restartProgress(version, vpns);
    return (
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-muted">{body}</p>
        <ul className="mt-2 grid gap-1.5">
          {steps.map(({ label, state }) => (
            <li
              key={label}
              className={cx(
                'flex items-center gap-2',
                state === 'active' ? 'font-medium' : 'text-muted',
              )}
            >
              <span className="grid size-3.5 place-items-center">{STEP_MARK[state]}</span>
              {label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { title, body } = restartQuestion(version, on.size);
  const restart = () => {
    setWereOn(on);
    void app.api.restartToUpdate();
  };
  return (
    <div role="dialog" aria-label={title}>
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-muted">{body}</p>
      <div className="mt-2.5 flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={onCancel}>
          Not now
        </button>
        <button
          type="button"
          className={cx(primary, 'px-3 py-[5px] text-[13px]')}
          onClick={restart}
        >
          Restart
        </button>
      </div>
    </div>
  );
}
