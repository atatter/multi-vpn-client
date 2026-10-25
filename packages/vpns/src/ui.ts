import type { KindForm } from '@repo/vpn-sdk/ui';
import { checkpointForm } from './integrations/checkpoint/form.tsx';
import { fortinetSslForm } from './integrations/fortinet-ssl/form.tsx';
import { globalprotectForm } from './integrations/globalprotect/form.tsx';
import type { VpnKind, VpnOf } from './index.ts';
import { openvpnForm } from './integrations/openvpn/form.tsx';

/** Every kind's window side: its wording and its form. */
export const FORMS: { [K in VpnKind]: KindForm<VpnOf<K>> } = {
  openvpn: openvpnForm,
  'fortinet-ssl': fortinetSslForm,
  globalprotect: globalprotectForm,
  checkpoint: checkpointForm,
};
