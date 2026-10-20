import type { Vpn } from "@repo/core";
import { vpnLabel } from "../domain/labels.ts";
import { useApp } from "../store/app-model.ts";
import { link } from "@repo/ui/tokens.ts";

/** Shown while the user signs in in the browser the app opened. */
export function BrowserSignInPrompt({ vpn }: { vpn: Vpn }) {
  const app = useApp();
  return (
    <div role="group" aria-label={`Signing in to ${vpnLabel(vpn)} in the browser`}>
      <p className="text-[13px] text-muted">
        Finish signing in in the browser window that opened, including any approval on your phone. The VPN connects by itself afterwards.
      </p>
      <div className="mt-2.5 flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={() => app.answer(vpn.id, null)}>
          Cancel
        </button>
        <button type="button" className={link} onClick={() => app.reopenSignIn(vpn.id)}>
          Open the page again
        </button>
      </div>
    </div>
  );
}
