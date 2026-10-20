import { TextField } from "@repo/ui/controls/TextField.tsx";
import { CERT_PIN_HINT, type KindForm } from "@repo/vpn-sdk/ui";
import type { FortinetSslVpn } from "./kind.ts";

/** Fortinet SSL VPN: a FortiGate gateway, often on port 10443. */
export const fortinetSslForm: KindForm<FortinetSslVpn> = {
  label: "Fortinet SSL VPN",
  hint: "FortiGate SSL VPN",
  changed: (vpn) => (vpn.realm ? [`realm ${vpn.realm}`] : []),
  Main: ({ vpn, onChange, errors, showAddress }) =>
    showAddress ? <TextField label="Gateway" monospace value={vpn.gateway} placeholder="vpn.example.com:10443" error={errors.gateway} onChange={(gateway) => onChange({ ...vpn, gateway })} /> : null,
  More: ({ vpn, onChange }) => (
    <>
      <TextField label="Realm" value={vpn.realm} hint="Only if your gateway uses one." onChange={(realm) => onChange({ ...vpn, realm })} />
      <TextField label="Trusted certificate" monospace value={vpn.serverCertPin} placeholder="pin-sha256:…" hint={CERT_PIN_HINT} onChange={(serverCertPin) => onChange({ ...vpn, serverCertPin })} />
    </>
  ),
  username: () => ({ hint: "Browser sign-in isn't supported yet, so a username is needed." }),
  extraOptions: { hint: "Extra openconnect flags.", placeholder: "--no-dtls" },
};
