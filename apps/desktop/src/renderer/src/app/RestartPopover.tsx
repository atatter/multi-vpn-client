import { useEffect } from "react";
import { useApp } from "../store/app-model.ts";
import { RestartConfirm } from "../vpn-list/RestartConfirm.tsx";

/**
 * The restart question over any screen, under the title bar's right end, while an update is ready or restarting. It
 * acts as a modal: a click outside it or Escape only closes it.
 */
export function RestartPopover({ onClose }: { onClose: () => void }) {
  const { update } = useApp();
  // Once restarting, the window is locked (App) and the question shows the VPNs turning off until the app quits.
  const closable = update.state === "ready";
  useEffect(() => {
    if (!closable) return;
    // Caught on its way down and stopped there, or Frame's Escape would also go back from the screen underneath and a
    // focused prompt's would cancel its sign-in.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closable, onClose]);
  if (update.state !== "ready" && update.state !== "restarting") return null;
  return (
    <>
      {/* Over the whole window, title bar included (no-drag), so the click that closes it reaches nothing else. */}
      <div className="fixed inset-0 z-10 [-webkit-app-region:no-drag]" onClick={onClose} />
      {/* Just under Frame's title bar, which is h-11. */}
      <div className="titlebar-insets pointer-events-none fixed inset-x-0 top-[43px] z-30 flex justify-end">
        <div className="pointer-events-auto w-[270px] rounded-[10px] border border-rule bg-raised p-3 text-[13px] shadow-lifted [-webkit-app-region:no-drag]">
          <RestartConfirm version={update.version} onCancel={onClose} />
        </div>
      </div>
    </>
  );
}
