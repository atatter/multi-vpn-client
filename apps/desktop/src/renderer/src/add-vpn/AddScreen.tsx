import { useApp } from "../store/app-model.ts";
import { openDropped } from "../store/import-profile.ts";
import { Frame } from "@repo/ui/Frame.tsx";
import { primary } from "@repo/ui/tokens.ts";
import { useFileDrop } from "@repo/ui/use-file-drop.ts";
import { AddressFields } from "./AddressFields.tsx";
import { useAddress } from "./use-address.ts";

/** Step 1: one question, the address. A file or picking the type yourself are the fallbacks, not the front door. */
export function AddScreen() {
  const app = useApp();
  const state = useAddress();
  useFileDrop((files) => openDropped(app, files));
  return (
    <Frame
      title="Add VPN"
      onBack={app.back}
      footer={
        <>
          <span>Step 1 of 2</span>
          <button type="button" className={primary} disabled={!state.next} onClick={state.next}>
            Next
          </button>
        </>
      }
    >
      <div className="px-[var(--in)] pt-3.5 pb-[18px]">
        <h2 className="text-lg font-semibold">Where do you sign in?</h2>
        <p className="mb-3 text-[13.5px] text-muted">The address you'd type into your company's VPN app.</p>
        <AddressFields state={state} autoFocus />
      </div>
    </Frame>
  );
}
