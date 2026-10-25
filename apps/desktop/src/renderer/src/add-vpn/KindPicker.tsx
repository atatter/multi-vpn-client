import { kindSpec, newVpn, VPN_KINDS, type VpnKind } from '@repo/core';
import { FORMS } from '@repo/vpns/ui';
import { useApp } from '../store/app-model.ts';
import { ChevronIcon } from '@repo/ui/icons.tsx';
import { cell, cells, cx, groupTitle, hint } from '@repo/ui/tokens.ts';

/** Kinds set up from a provider's file (OpenVPN's .ovpn): picking one opens the file picker. */
const needsFile = (kind: VpnKind) =>
  kindSpec(kind).secrets.some((slot) => slot.required && slot.importOnly);

/** Picking the VPN's type yourself, when it can't be detected. */
export function KindPicker({ onChooseFile }: { onChooseFile: () => void }) {
  const app = useApp();
  return (
    <section className="mt-3.5">
      <h2 className={groupTitle}>Pick the type yourself</h2>
      <div className={cells}>
        {VPN_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={cx(cell, 'hover:bg-[color-mix(in_srgb,var(--field)_94%,var(--ink))]')}
            onClick={() =>
              needsFile(kind)
                ? onChooseFile()
                : app.push({
                    name: 'signin',
                    draft: newVpn(kind, { id: crypto.randomUUID(), name: '' }),
                    secrets: {},
                    source: { from: 'type' },
                  })
            }
          >
            <span>
              {FORMS[kind].label}
              <span className={hint}>{FORMS[kind].hint}</span>
            </span>
            <ChevronIcon className="text-off" />
          </button>
        ))}
      </div>
    </section>
  );
}
