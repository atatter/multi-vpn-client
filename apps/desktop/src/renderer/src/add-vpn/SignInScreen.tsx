import { type RouteRule, type Vpn, vpnAddress } from '@repo/core';
import { useState } from 'react';
import { FORMS } from '@repo/vpns/ui';
import { TRAFFIC_LABEL, vpnLabel } from '../domain/labels.ts';
import type { PendingSecrets } from '../domain/secrets.ts';
import { useApp } from '../store/app-model.ts';
import type { Screen } from '../store/screen.ts';
import { TrafficChoice } from '../traffic/TrafficChoice.tsx';
import { Frame } from '@repo/ui/Frame.tsx';
import { Fold } from '@repo/ui/controls/Fold.tsx';
import { TextField } from '@repo/ui/controls/TextField.tsx';
import { cx, link, mono, note, primary } from '@repo/ui/tokens.ts';
import { AccountFields } from '../vpn-form/AccountFields.tsx';
import { formErrors } from '../domain/form-errors.ts';

/**
 * Step 2: only what's needed to sign in, ending in Connect, so setup finishes with a working VPN. Name and
 * traffic are folded with sensible defaults: the name comes from the address, traffic follows the official app.
 */
export function SignInScreen({ screen }: { screen: Extract<Screen, { name: 'signin' }> }) {
  const app = useApp();
  const [draft, setDraft] = useState<Vpn>(screen.draft);
  const [pending, setPending] = useState<PendingSecrets>(screen.secrets);
  const [routes, setRoutes] = useState<RouteRule[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [moreOpen, setMoreOpen] = useState(screen.source.from === 'type');
  const [saving, setSaving] = useState(false);
  const { source } = screen;

  const errors = formErrors(draft, routes, [], pending);
  const shown = showErrors ? errors : {};
  const errorCount = Object.keys(shown).length;
  // A folded section with a problem opens itself, so errors are never hidden.
  const moreShown = moreOpen || !!shown.name || !!shown.sites;
  const sameServer = app.config.vpns.some((vpn) => vpn.kind === draft.kind && vpnAddress(vpn) === vpnAddress(draft));

  const add = async (connect: boolean) => {
    if (Object.keys(errors).length > 0) return setShowErrors(true);
    setSaving(true);
    const saved = await app.save({ ...app.config, vpns: [...app.config.vpns, draft], routes: [...app.config.routes, ...routes] }, { [draft.id]: pending });
    setSaving(false);
    if (!saved) return;
    app.home();
    if (connect) void app.connect(draft.id);
  };

  return (
    <Frame
      title={source.from === 'type' ? `New ${FORMS[draft.kind].label} VPN` : `Sign in to ${vpnLabel(draft)}`}
      onBack={app.back}
      footer={
        <>
          {errorCount > 0 ? <span className="text-danger">Fill in the {errorCount === 1 ? 'highlighted field' : `${errorCount} highlighted fields`}.</span> : <span>Step 2 of 2</span>}
          <span className="flex items-center gap-4">
            <button type="button" className={link} disabled={saving} onClick={() => void add(false)}>
              Save only
            </button>
            <button type="button" className={primary} disabled={saving} onClick={() => void add(true)}>
              Connect
            </button>
          </span>
        </>
      }
    >
      <div className="px-[var(--in)] pt-3 pb-[18px]">
        {source.from === 'file' && <p className={cx(note, 'mb-3 bg-signal/10')}>Read from {source.fileName}.</p>}
        {sameServer && <p className={cx(note, 'mb-3 bg-chip')}>You already have an account on {vpnAddress(draft)}. This adds another one.</p>}
        {source.from !== 'type' && (
          <p className="mb-3 text-[13px] text-muted">
            {FORMS[draft.kind].label} · <span className={mono}>{vpnAddress(draft)}</span>
          </p>
        )}
        {source.from === 'address' && source.browserSignIn && FORMS[draft.kind].noBrowserSignIn && (
          <p className={cx(note, 'mb-3 bg-sodium/10')}>{FORMS[draft.kind].noBrowserSignIn}</p>
        )}
        <AccountFields
          vpn={draft}
          onChange={setDraft}
          pending={pending}
          onPendingChange={setPending}
          storedSlots={[]}
          errors={shown}
          keychainProblem={app.keychainProblem}
          showAddress={source.from === 'type'}
        />
        <div className="mt-2">
          <Fold title="Name and traffic" summary={`“${vpnLabel(draft)}” · ${TRAFFIC_LABEL[draft.traffic]}`} open={moreShown} onToggle={() => setMoreOpen(!moreShown)}>
            <TextField label="Name" value={draft.name} placeholder="Client or network name" error={shown.name} onChange={(name) => setDraft({ ...draft, name })} />
            <TrafficChoice vpn={draft} routes={routes} onTraffic={(traffic) => setDraft({ ...draft, traffic })} onRoutes={setRoutes} />
            {shown.sites && <span className="mt-1.5 block text-[12.5px] text-danger">{shown.sites}</span>}
          </Fold>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">DNS, certificates and other advanced settings are on the VPN's page after it's added.</p>
      </div>
    </Frame>
  );
}
