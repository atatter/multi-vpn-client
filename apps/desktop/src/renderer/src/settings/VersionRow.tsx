import { useState } from 'react';
import { type UpdateRun, versionRow } from '../domain/update-copy.ts';
import { useApp } from '../store/app-model.ts';
import { cell, cx, link } from '@repo/ui/tokens.ts';
import { RestartConfirm } from '../vpn-list/RestartConfirm.tsx';

/**
 * Settings → About's Version row: the version, the update's status and its one short action. Always two lines at a
 * fixed height, so it doesn't jump between states; a download shows as a thin bar along the bottom edge.
 */
export function VersionRow() {
  const app = useApp();
  const { update } = app;
  // "Checked a minute ago" counts from when Settings opened: nothing here re-renders on a timer.
  const [now] = useState(Date.now);
  const [confirming, setConfirming] = useState(false);
  const { line, failed, action } = versionRow(update, now);
  const run: Record<UpdateRun, () => void> = {
    check: () => void app.api.checkForUpdate(),
    download: () => void app.api.downloadUpdate(),
    restart: () => setConfirming(!confirming),
  };
  return (
    <>
      <div className={cx(cell, 'relative h-[54px]')}>
        <span className="min-w-0">
          Version {app.info.version}
          {/* Not `hint`: its text-muted would win over text-danger, whatever the order here. */}
          <span className={cx('block truncate text-[12.5px]', failed ? 'text-danger' : 'text-muted')} title={line}>
            {line}
          </span>
        </span>
        {action && (
          <button type="button" className={cx(link, 'whitespace-nowrap')} disabled={action.disabled} onClick={run[action.run]}>
            {action.label}
          </button>
        )}
        {update.state === 'downloading' && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-rule">
            <span className="block h-full bg-signal" style={{ width: `${update.percent}%` }} />
          </span>
        )}
      </div>
      {confirming && (update.state === 'ready' || update.state === 'restarting') && (
        <div className="px-3 py-2.5 text-[13px]">
          <RestartConfirm version={update.version} onCancel={() => setConfirming(false)} />
        </div>
      )}
    </>
  );
}
