import type { LauncherEntry } from "@repo/vpn-sdk/engine";
import { checkpointEngine } from "./integrations/checkpoint/engine.ts";
import { fortinetSslEngine } from "./integrations/fortinet-ssl/engine.ts";
import { globalprotectEngine } from "./integrations/globalprotect/engine.ts";
import type { VpnKind, VpnOf } from "./index.ts";
import { openvpnEngine } from "./integrations/openvpn/engine.ts";

/** Every kind's engine side (Node only): how to run its client. */
export const LAUNCHERS: { [K in VpnKind]: LauncherEntry<VpnOf<K>> } = {
  openvpn: openvpnEngine,
  "fortinet-ssl": fortinetSslEngine,
  globalprotect: globalprotectEngine,
  checkpoint: checkpointEngine,
};
