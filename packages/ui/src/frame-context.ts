import { createContext, useContext } from "react";

/** What the window frame needs from the app. App provides it, so the frame itself knows nothing about VPNs. */
export interface FrameEnvironment {
  platform: "darwin" | "win32" | "linux";
  /** A failed save or action, shown under the title bar until dismissed. */
  notice: string | undefined;
  dismissNotice: () => void;
  /** How the current screen arrived, for its slide-in. */
  direction: "push" | "pop" | undefined;
  /** Sizes the window to the content's natural height. */
  fitWindow: (height: number) => void;
}

export const FrameContext = createContext<FrameEnvironment | null>(null);

export function useFrameEnvironment(): FrameEnvironment {
  const environment = useContext(FrameContext);
  if (!environment) throw new Error("Frame needs the FrameContext provider");
  return environment;
}
