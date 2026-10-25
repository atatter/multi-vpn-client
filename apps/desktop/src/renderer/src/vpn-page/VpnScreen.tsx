import type { RouteRule, Vpn } from '@repo/core';
import { useState } from 'react';
import { isOn } from '../domain/connection.ts';
import { formErrors } from '../domain/form-errors.ts';
import { vpnLabel } from '../domain/labels.ts';
import type { PendingSecrets } from '../domain/secrets.ts';
import { useApp } from '../store/app-model.ts';
import { Frame } from '@repo/ui/Frame.tsx';
import { EditFooter } from './EditFooter.tsx';
import { RemoveVpn } from './RemoveVpn.tsx';
import { StatusCard } from './StatusCard.tsx';
import { TrafficSection } from './TrafficSection.tsx';
import { VpnFolds } from './VpnFolds.tsx';
import {
  changedFields,
  configAfterRemove,
  configAfterSave,
  isDirty,
  routeEditsOf,
  savingReconnects,
  siteWarnings,
} from './vpn-edit.ts';

/**
 * One VPN on one screen: its status, what goes through it, then folded Account and Advanced. One Save for
 * all of it; leaving with unsaved changes asks first. Only the user's own edits are held here, on top of
 * the saved VPN, so what the app saves meanwhile (a remembered password, what the server sends) is never
 * mistaken for an unsaved change.
 */
export function VpnScreen({ vpnId }: { vpnId: string }) {
  const app = useApp();
  const vpn = app.config.vpns.find((candidate) => candidate.id === vpnId);
  const savedRoutes = app.config.routes.filter((route) => route.vpnId === vpnId);
  const [edits, setEdits] = useState<Partial<Vpn>>({});
  /** The VPN's sites as edited; undefined while they're unchanged, so they follow the saved ones. */
  const [routeEdits, setRouteEdits] = useState<RouteRule[]>();
  const [pending, setPending] = useState<PendingSecrets>({});
  const [showErrors, setShowErrors] = useState(false);
  /** Where the user was going when asked to discard their changes, until they answer. */
  const [leaving, setLeaving] = useState<{ go: () => void }>();
  const [saving, setSaving] = useState(false);
  if (!vpn) {
    return null;
  } // removed meanwhile: there's nothing left to show

  // The kind is fixed on this page, so the saved VPN plus the edited fields is still the same kind.
  const draft = { ...vpn, ...edits } as Vpn;
  const setDraft = (next: Vpn) => setEdits(changedFields(vpn, next));
  const routes = routeEdits ?? savedRoutes;
  const setRoutes = (next: RouteRule[]) => setRouteEdits(routeEditsOf(next, savedRoutes));

  const connection = app.connections[vpn.id];
  const connected = connection?.state === 'connected';
  const stored = app.secretStatus[vpn.id] ?? [];
  const errors = formErrors(draft, routes, stored, pending);
  const shown = showErrors ? errors : {};
  const dirty = isDirty(vpn, draft, routeEdits, pending);
  const reconnects = savingReconnects(vpn, draft, pending, connected);
  const name = vpnLabel(draft);

  const discard = () => {
    setEdits({});
    setRouteEdits(undefined);
    setPending({});
    setShowErrors(false);
    setLeaving(undefined);
  };

  /** Goes elsewhere, asking first when there are unsaved changes. */
  const leave = (go: () => void) => (dirty ? setLeaving({ go }) : go());

  const save = async () => {
    if (Object.keys(errors).length > 0) {
      return setShowErrors(true);
    }

    setSaving(true);
    const saved = await app.save(configAfterSave(app.config, vpn, draft, routes), {
      [vpn.id]: pending,
    });
    setSaving(false);
    if (!saved) {
      return;
    }

    // Saved: stay on the page, which now shows the saved VPN.
    discard();

    if (reconnects) {
      void app.reconnect(vpn.id);
    }
  };

  const remove = async () => {
    await app.turnOff(vpn.id).catch(() => undefined);
    const saved = await app.save(configAfterRemove(app.config, vpn.id));
    if (saved) {
      app.home();
    }
  };

  return (
    <Frame
      onBack={() => leave(app.back)}
      footer={
        leaving || dirty ? (
          <EditFooter
            confirmingLeave={!!leaving}
            reconnects={reconnects}
            saving={saving}
            onSave={() => void save()}
            onDiscard={() => {
              discard();
              leaving?.go();
            }}
            onKeepEditing={() => setLeaving(undefined)}
          />
        ) : undefined
      }
    >
      <div className="px-[var(--in)] pt-3 pb-[18px]">
        {/* The only place the page names the VPN: one line, cut short when long, in full on hover. */}
        <h1 className="mb-2.5 truncate text-[17px] font-semibold" title={name}>
          {name}
        </h1>
        <StatusCard vpn={vpn} leave={leave} />

        <TrafficSection
          saved={vpn}
          draft={draft}
          routes={routes}
          warnings={siteWarnings(app.config, draft, routes)}
          error={shown.sites}
          connected={connected}
          onTraffic={(traffic) => setDraft({ ...draft, traffic })}
          onRoutes={setRoutes}
        />
        <VpnFolds
          draft={draft}
          onChange={setDraft}
          pending={pending}
          onPendingChange={setPending}
          storedSlots={stored}
          errors={shown}
          keychainProblem={app.keychainProblem}
        />

        <div className="mt-[18px]">
          <RemoveVpn
            name={name}
            hasSecrets={stored.length > 0}
            on={isOn(connection)}
            onRemove={() => void remove()}
          />
        </div>
      </div>
    </Frame>
  );
}
