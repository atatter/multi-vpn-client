import type { Detection } from '@repo/core';
import { FORMS } from '@repo/vpns/ui';
import { hint } from '@repo/ui/tokens.ts';

/** Under the address box: checking it, what it turned out to be, or an example while nothing is typed. */
export function DetectionLine({
  checking,
  typed,
  detection,
}: {
  checking: boolean;
  typed: string;
  detection: Detection | undefined;
}) {
  return (
    <div className="mt-1.5 min-h-5 text-[13px]" aria-live="polite">
      {checking ? (
        <span className="text-sodium">Checking {typed}…</span>
      ) : detection?.kind === 'unknown' ? (
        <span className="text-sodium">Couldn't tell what kind of VPN this is. Pick it below.</span>
      ) : detection ? (
        <span className="text-go">
          ✓ {FORMS[detection.kind].label}
          {detection.browserSignIn ? ' · signs in through the browser' : ''}
        </span>
      ) : (
        <span className={hint}>For example vpn.example.com</span>
      )}
    </div>
  );
}
