import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppContext } from "../store/app-model.ts";
import type { Screen } from "../store/screen.ts";
import type { AppStore, Navigation } from "../store/store.ts";
import { FrameContext, type FrameEnvironment } from "@repo/ui/frame-context.ts";
import { ScreenView } from "./ScreenView.tsx";

/**
 * The window: what the store says, as screens. The store holds what main reports and what connecting
 * needs; which screen is showing is only the window's business, so it's state here.
 */
export function App({ store }: { store: AppStore }) {
  const view = useSyncExternalStore(store.subscribe, store.getState);
  const root = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: "list" }]);
  const [direction, setDirection] = useState<FrameEnvironment["direction"]>();

  // Screens size the window themselves (see Frame); before one shows, a short window is enough.
  useLayoutEffect(() => {
    if (view.phase !== "ready" && root.current) void store.api.fitWindow(root.current.offsetHeight);
  }, [view.phase, store]);

  if (view.phase === "failed") {
    return (
      <div ref={root} className="p-6 pt-14 text-sm text-danger select-text">
        Couldn't load your settings: {view.error}
      </div>
    );
  }
  if (view.phase === "loading") return <div ref={root} className="h-40" />;

  // Moving to another screen closes a VPN's open prompt: it belongs to the screen it was asked on.
  const go = (next: FrameEnvironment["direction"], change: (current: Screen[]) => Screen[]) => {
    setDirection(next);
    view.cancelPrompt();
    setStack(change);
  };
  const navigation: Navigation = {
    push: (screen) => go("push", (current) => [...current, screen]),
    back: () => go("pop", (current) => (current.length > 1 ? current.slice(0, -1) : current)),
    home: () => go("pop", () => [{ name: "list" }]),
  };
  const frame: FrameEnvironment = {
    platform: view.info.platform,
    notice: view.notice,
    dismissNotice: view.dismissNotice,
    direction,
    fitWindow: view.api.fitWindow,
  };
  const top = stack.at(-1) ?? { name: "list" };
  return (
    <AppContext value={{ ...view, ...navigation }}>
      <FrameContext value={frame}>
        <div ref={root}>
          {/* Keyed by depth, so each push or pop mounts the screen fresh and plays its slide. */}
          <div key={`${stack.length}-${top.name}`}>
            <ScreenView screen={top} />
          </div>
        </div>
      </FrameContext>
    </AppContext>
  );
}
