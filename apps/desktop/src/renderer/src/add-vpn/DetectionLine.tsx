import type { Detection } from '@repo/core';
import { FORMS } from '@repo/vpns/ui';
import { hint } from '@repo/ui/tokens.ts';

type DetectionProps = { checking: boolean; typed: string; detection: Detection | undefined };

/** Under the address box: checking it, what it turned out to be, or an example while nothing is typed. */
export function DetectionLine(props: DetectionProps) {
  return (
    <div className="mt-1.5 min-h-5 text-[13px]" aria-live="polite">
      {detectionText(props)}
    </div>
  );
}

function detectionText({ checking, typed, detection }: DetectionProps) {
  if (checking) {
    return <span className="text-sodium">Checking {typed}…</span>;
  }
  if (!detection) {
    return <span className={hint}>For example vpn.example.com</span>;
  }
  if (detection.kind === 'unknown') {
    return (
      <span className="text-sodium">Couldn't tell what kind of VPN this is. Pick it below.</span>
    );
  }
  return (
    <span className="text-go">
      ✓ {FORMS[detection.kind].label}
      {detection.browserSignIn ? ' · signs in through the browser' : ''}
    </span>
  );
}
