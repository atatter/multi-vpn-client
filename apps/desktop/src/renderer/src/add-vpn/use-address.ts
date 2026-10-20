import { type Detection, HostPort, isIpv4 } from "@repo/core";
import { useEffect, useState } from "react";
import { useApp } from "../store/app-model.ts";
import { draftFor } from "./draft.ts";

/** Complete enough to probe: a valid host ending in a real-looking top-level label (or an IP), so fragments aren't looked up. */
const looksLikeAddress = (text: string) => {
  const host = text.trim().replace(/:\d+$/, "");
  return HostPort.safeParse(text.trim()).success && (/\.[a-z]{2,}$/i.test(host) || isIpv4(host));
};

/**
 * Step 1 of adding a VPN, as state: the address, what probing it found (debounced while typing), and
 * the next step once it's known. Shared by the first-launch screen and the Add screen.
 */
export function useAddress() {
  const app = useApp();
  const { api } = app;
  const [address, setAddress] = useState("");
  const [found, setFound] = useState<{ address: string; detection: Detection }>();
  const [manual, setManual] = useState(false);
  const typed = address.trim();
  const checking = looksLikeAddress(typed) && found?.address !== typed;

  useEffect(() => {
    if (!looksLikeAddress(typed)) return;
    let current = true;
    // Probing starts once typing pauses, not on every key.
    const timer = setTimeout(() => {
      void api.detect(typed).then(
        (detection) => {
          if (!current) return;
          setFound({ address: typed, detection });
          if (detection.kind === "unknown") setManual(true);
        },
        () => current && setFound({ address: typed, detection: { kind: "unknown" } }),
      );
    }, 750);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed, api]);

  const detection = found?.address === typed ? found.detection : undefined;
  const next =
    detection && detection.kind !== "unknown"
      ? () => app.push({ name: "signin", draft: draftFor(detection, app.config.vpns), secrets: {}, source: { from: "address", browserSignIn: !!detection.browserSignIn } })
      : undefined;
  return { address, setAddress, typed, checking, detection, manual, setManual, next };
}
