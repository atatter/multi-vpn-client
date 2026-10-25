import { PASSWORD_SLOT } from '@repo/vpn-sdk';
import { Choices } from '@repo/ui/controls/Choices.tsx';
import { SelectField } from '@repo/ui/controls/SelectField.tsx';
import { TextField } from '@repo/ui/controls/TextField.tsx';
import { ToggleRow } from '@repo/ui/controls/ToggleRow.tsx';
import { label } from '@repo/ui/tokens.ts';
import { CERT_PIN_HINT, type KindForm } from '@repo/vpn-sdk/ui';
import { type GlobalProtectVpn, ID_CARD_CERTIFICATE } from './kind.ts';

/** GlobalProtect: a portal (or gateway), signing in with a password or an ID card. */
export const globalprotectForm: KindForm<GlobalProtectVpn> = {
  label: 'GlobalProtect',
  hint: 'Palo Alto Networks',
  changed: (vpn) => [
    ...(vpn.gateway ? [`gateway ${vpn.gateway}`] : []),
    ...(vpn.connectAs === 'gateway' ? ['connects to the gateway'] : []),
    ...(vpn.reportedOs === 'win'
      ? []
      : [`reports as ${vpn.reportedOs === 'mac' ? 'macOS' : 'Linux'}`]),
    ...(vpn.hip ? ['HIP report on'] : []),
  ],
  signsInWith: (vpn) => {
    if (vpn.signIn !== 'card') {
      return undefined;
    }
    return vpn.cardCertificate ? 'Smart card' : 'ID card';
  },
  noBrowserSignIn:
    "This portal signs in through the browser, which this app can't do for GlobalProtect yet. Use a username and password, or an ID card.",
  Main: ({ vpn, onChange, errors, showAddress, storedSlots, setSecret }) => (
    <>
      {showAddress && (
        <TextField
          label="Portal"
          monospace
          value={vpn.portal}
          placeholder="vpn.example.com"
          error={errors.portal}
          onChange={(portal) => onChange({ ...vpn, portal })}
        />
      )}
      <div className="mb-3 grid gap-1">
        <span className={label}>Sign in with</span>
        <Choices
          label="Sign in with"
          value={vpn.signIn}
          options={[
            { value: 'password', title: 'Username and password' },
            {
              value: 'card',
              title: 'ID card',
              description:
                "The card in this computer's card reader. You type its PIN1 when you connect.",
            },
          ]}
          onChange={(signIn) => {
            // The card replaces the password, so a remembered one goes.
            onChange({ ...vpn, signIn, ...(signIn === 'card' ? { rememberPassword: false } : {}) });
            if (signIn === 'card') {
              setSecret(
                PASSWORD_SLOT.key,
                storedSlots.includes(PASSWORD_SLOT.key) ? null : undefined,
              );
            }
          }}
        />
      </div>
    </>
  ),
  More: ({ vpn, onChange, errors }) => (
    <>
      <TextField
        label="Gateway"
        monospace
        value={vpn.gateway}
        placeholder="Chosen by the portal"
        error={errors.gateway}
        onChange={(gateway) => onChange({ ...vpn, gateway })}
      />
      <SelectField
        label="Connect to the address as"
        value={vpn.connectAs}
        options={[
          { value: 'portal', label: 'Portal (usual)' },
          { value: 'gateway', label: 'Gateway directly' },
        ]}
        onChange={(connectAs) => onChange({ ...vpn, connectAs })}
      />
      <SelectField
        label="Report this computer as"
        value={vpn.reportedOs}
        options={[
          { value: 'win', label: 'Windows' },
          { value: 'mac', label: 'macOS' },
          { value: 'linux', label: 'Linux' },
        ]}
        hint="Some portals only offer browser sign-in to Windows."
        onChange={(reportedOs) => onChange({ ...vpn, reportedOs })}
      />
      <ToggleRow
        label="Send HIP report"
        hint="Only turn on if your IT team has agreed."
        checked={vpn.hip}
        onChange={(hip) => onChange({ ...vpn, hip })}
      />
      {vpn.signIn === 'card' && (
        <TextField
          label="Card certificate"
          monospace
          value={vpn.cardCertificate}
          placeholder={ID_CARD_CERTIFICATE}
          error={errors.cardCertificate}
          hint="Leave it empty for an Estonian ID card. For another card, the certificate's PKCS#11 URI (p11tool --list-all-certs)."
          onChange={(cardCertificate) => onChange({ ...vpn, cardCertificate })}
        />
      )}
      <TextField
        label="Trusted certificate"
        monospace
        value={vpn.serverCertPin}
        placeholder="pin-sha256:…"
        hint={CERT_PIN_HINT}
        onChange={(serverCertPin) => onChange({ ...vpn, serverCertPin })}
      />
    </>
  ),
  username: (vpn) =>
    vpn.signIn === 'card'
      ? {
          placeholder: 'login',
          hint: 'Gateways that sign in with the card ignore it. Leave it empty to send “login”.',
        }
      : { hint: "Browser sign-in isn't supported yet, so a username is needed." },
  extraOptions: { hint: 'Extra openconnect flags.', placeholder: '--no-dtls' },
};
