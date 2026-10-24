import { updateTooltip } from "../domain/update-copy.ts";
import { useApp } from "../store/app-model.ts";
import { DownloadIcon, RestartIcon } from "@repo/ui/icons.tsx";
import { cx, iconButton } from "@repo/ui/tokens.ts";

const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The update, next to Settings and styled exactly like it, only while there's one to act on. The icon is the state
 * (available, downloading with a ring, ready, failed with a red dot) and the tooltip says it. Restarting asks first,
 * in the restart question App shows over the screen.
 */
export function UpdateButton() {
  const app = useApp();
  const { update } = app;
  const readyOrRestarting = update.state === "ready" || update.state === "restarting";
  const tip = updateTooltip(update);
  if (!tip) return null;

  const onClick = () => {
    if (update.state === "ready") app.askRestart();
    else if (update.state === "available" || update.state === "download-failed") void app.api.downloadUpdate();
  };
  return (
    <button type="button" className={cx(iconButton, "relative")} title={tip} aria-label={tip} onClick={onClick}>
      {update.state === "downloading" ? (
        <>
          <svg className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
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
      ) : readyOrRestarting ? (
        <span className="relative grid place-items-center">
          <RestartIcon />
          <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-ink text-bg ring-2 ring-bg">
            <svg width="6" height="6" viewBox="0 0 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M1 3.2 2.4 4.5 5 1.5" />
            </svg>
          </span>
        </span>
      ) : (
        <span className="relative grid place-items-center">
          <DownloadIcon />
          <span className={cx("absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-bg", update.state === "download-failed" ? "bg-danger" : "bg-current")} />
        </span>
      )}
    </button>
  );
}
