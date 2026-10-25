import type { UpdateState } from '../../../shared/ipc-contract.ts';
import { DownloadIcon, RestartIcon } from '@repo/ui/icons.tsx';
import { cx } from '@repo/ui/tokens.ts';

const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function UpdateIcon({ update }: { update: UpdateState }) {
  if (update.state === 'downloading') {
    return (
      <>
        <svg
          className="pointer-events-none absolute inset-0 size-full -rotate-90"
          viewBox="0 0 30 30"
          aria-hidden="true"
        >
          <circle
            cx="15"
            cy="15"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="1.5"
          />
          <circle
            cx="15"
            cy="15"
            r={RING_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - update.percent / 100)}
          />
        </svg>
        <DownloadIcon />
      </>
    );
  }
  if (update.state === 'ready' || update.state === 'restarting') {
    return (
      <span className="relative grid place-items-center">
        <RestartIcon />
        <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-ink text-bg ring-2 ring-bg">
          <svg
            width="6"
            height="6"
            viewBox="0 0 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M1 3.2 2.4 4.5 5 1.5" />
          </svg>
        </span>
      </span>
    );
  }

  return (
    <span className="relative grid place-items-center">
      <DownloadIcon />
      <span
        className={cx(
          'absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-bg',
          update.state === 'download-failed' ? 'bg-danger' : 'bg-current',
        )}
      />
    </span>
  );
}
