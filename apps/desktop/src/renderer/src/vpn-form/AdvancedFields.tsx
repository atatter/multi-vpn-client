import { Vpn } from '@repo/core';
import { ListField } from '@repo/ui/controls/ListField.tsx';
import { cx, hint, input, label, mono } from '@repo/ui/tokens.ts';
import { errorAt, type FormErrors } from '../domain/form-errors.ts';
import { FORMS } from '@repo/vpns/ui';
import { KindMoreFields } from './kind-forms.tsx';

/** The rarely needed settings: kind-specific options, DNS, and raw extra options for the VPN's client. */
export function AdvancedFields({ vpn, onChange, errors }: { vpn: Vpn; onChange: (vpn: Vpn) => void; errors: FormErrors }) {
  return (
    <>
      <KindMoreFields kind={vpn.kind} vpn={vpn} onChange={onChange} errors={errors} />
      <ListField
        label="DNS servers"
        values={vpn.dns.servers}
        placeholder="Provided by the VPN"
        error={errorAt(errors, 'dns.servers')}
        hint="Leave empty to use the servers the VPN provides."
        onChange={(servers) => onChange({ ...vpn, dns: { ...vpn.dns, servers } })}
      />
      <ListField
        label="DNS domains"
        values={vpn.dns.domains}
        placeholder="client-a.internal"
        error={errorAt(errors, 'dns.domains')}
        hint="Names looked up through this VPN's DNS servers."
        onChange={(domains) => onChange({ ...vpn, dns: { ...vpn.dns, domains } })}
      />
      <label className="mb-3 grid min-w-0 gap-1">
        <span className={label}>Extra options</span>
        <textarea
          className={cx(input(), mono, 'h-[70px] resize-y py-2')}
          value={vpn.advanced}
          placeholder={FORMS[vpn.kind].extraOptions.placeholder}
          spellCheck={false}
          onChange={(event) => onChange({ ...vpn, advanced: event.target.value })}
        />
        <span className={hint}>{FORMS[vpn.kind].extraOptions.hint}</span>
      </label>
    </>
  );
}
