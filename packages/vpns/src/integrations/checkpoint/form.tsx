import { SelectField } from "@repo/ui/controls/SelectField.tsx";
import { TextField } from "@repo/ui/controls/TextField.tsx";
import { LoginTypeField } from "./LoginTypeField.tsx";
import type { KindForm } from "@repo/vpn-sdk/ui";
import type { CheckpointVpn } from "./kind.ts";

/** Check Point: a server and one of the login types it offers. */
export const checkpointForm: KindForm<CheckpointVpn> = {
  label: "Check Point",
  hint: "Check Point Mobile / Endpoint",
  changed: (vpn) => (vpn.tunnel === "ssl" ? ["SSL tunnel"] : []),
  Main: ({ vpn, onChange, errors, showAddress, runAction }) => (
    <>
      {showAddress && <TextField label="Server" monospace value={vpn.server} placeholder="remote.example.com" error={errors.server} onChange={(server) => onChange({ ...vpn, server })} />}
      {/* When the server is already known (the sign-in step), its login types are looked up straight away. */}
      <LoginTypeField server={vpn.server} value={vpn.loginType} error={errors.loginType} onChange={(loginType) => onChange({ ...vpn, loginType })} autoLookup={!showAddress} runAction={runAction} />
    </>
  ),
  More: ({ vpn, onChange }) => (
    <SelectField
      label="Tunnel"
      value={vpn.tunnel}
      options={[
        { value: "ipsec", label: "IPsec (recommended)" },
        { value: "ssl", label: "SSL (older gateways)" },
      ]}
      onChange={(tunnel) => onChange({ ...vpn, tunnel })}
    />
  ),
  username: () => ({ hint: "Leave empty for Microsoft (Entra ID) sign-in in the browser." }),
  extraOptions: { hint: "Extra snx-rs options, key=value per line.", placeholder: "transport-type=tcpt" },
};
