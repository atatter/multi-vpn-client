import { useState } from "react";

/** Runs a setup action, showing it as busy meanwhile and its error after. */
export function useSetupAction(run: () => Promise<string | undefined>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return {
    busy,
    error,
    go: () => {
      setBusy(true);
      setError(undefined);
      void run().then((problem) => {
        setError(problem);
        setBusy(false);
      });
    },
  };
}
