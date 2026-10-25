import { useEffect, useState } from 'react';
import { updateTooltip } from '../domain/update-copy.ts';
import { useApp } from '../store/app-model.ts';
import { cx, iconButton } from '@repo/ui/tokens.ts';
import { RestartConfirm } from './RestartConfirm.tsx';
import { UpdateIcon } from './UpdateIcon.tsx';

/**
 * The update, next to Settings and styled exactly like it, only while there's one to act on. The icon is the state
 * (available, downloading with a ring, ready, failed with a red dot) and the tooltip says it. Restarting asks first,
 * in a popover that acts as a modal: a click outside it or Escape only closes it.
 */
export function UpdateButton() {
  const app = useApp();
  const [confirming, setConfirming] = useState(false);
  const { update } = app;
  const readyOrRestarting = update.state === 'ready' || update.state === 'restarting';
  const open = confirming && readyOrRestarting;
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setConfirming(false);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);
  const tip = updateTooltip(update);
  if (!tip) {
    return null;
  }

  const onClick = () => {
    if (update.state === 'ready') {
      setConfirming(!confirming);
    } else if (update.state === 'available' || update.state === 'download-failed') {
      void app.api.downloadUpdate();
    }
  };
  return (
    <span className="relative">
      <button
        type="button"
        className={cx(iconButton, 'relative')}
        title={tip}
        aria-label={tip}
        onClick={onClick}
      >
        <UpdateIcon update={update} />
      </button>
      {open && (
        <>
          {/* Over the whole window, title bar included (no-drag), so the click that closes it reaches nothing else. */}
          <div
            className="fixed inset-0 z-10 [-webkit-app-region:no-drag]"
            onClick={() => setConfirming(false)}
          />
          <div className="absolute top-[36px] right-0 z-30 w-[270px] rounded-[10px] border border-rule bg-raised p-3 text-[13px] shadow-lifted [-webkit-app-region:no-drag]">
            <RestartConfirm version={update.version} onCancel={() => setConfirming(false)} />
          </div>
        </>
      )}
    </span>
  );
}
