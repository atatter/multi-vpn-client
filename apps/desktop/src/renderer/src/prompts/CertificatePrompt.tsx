import type { Vpn } from '@repo/core';
import { vpnLabel } from '../domain/labels.ts';
import { useApp } from '../store/app-model.ts';
import type { Prompt } from '../store/screen.ts';
import { cx, danger, link, mono, primary } from '@repo/ui/tokens.ts';

/**
 * Asked in the row when the gateway's certificate isn't publicly trusted, or no longer matches the one
 * trusted before. Trusting saves its pin, so only this exact certificate is accepted from then on.
 */
export function CertificatePrompt({
  vpn,
  prompt,
}: {
  vpn: Vpn;
  prompt: Extract<Prompt, { kind: 'certificate' }>;
}) {
  const app = useApp();
  return (
    <div
      role="group"
      aria-label={`${vpnLabel(vpn)}'s certificate`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          return;
        }
        event.preventDefault();
        app.cancelPrompt();
      }}
    >
      <p className="text-[13px] text-muted select-text">
        {prompt.changed
          ? `${prompt.server} presented a different certificate than the one you trusted. That's expected when it's renewed, but it's also what an attack looks like. Only trust it if your IT team confirms the change.`
          : `${prompt.server} presented a certificate that isn't publicly trusted, which is common for VPN gateways. If unsure, check its fingerprint with your IT team.`}
      </p>
      <p className={cx(mono, 'my-2.5 rounded-[7px] bg-chip px-2.5 py-2 break-all select-text')}>
        {prompt.pin}
      </p>
      <div className="flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={app.cancelPrompt}>
          Cancel
        </button>
        <button
          type="button"
          className={prompt.changed ? danger : primary}
          autoFocus={!prompt.changed}
          onClick={app.trustCertificate}
        >
          {prompt.changed ? 'Trust the new one' : 'Trust and connect'}
        </button>
      </div>
    </div>
  );
}
