import { AddForm } from "../add-vpn/AddForm.tsx";
import { setupBlocker } from "../domain/setup-copy.ts";
import { SetupCard } from "../setup/SetupCard.tsx";
import { SetupLine } from "../setup/SetupLine.tsx";
import { useApp } from "../store/app-model.ts";
import { openDropped } from "../store/import-profile.ts";
import { Frame } from "@repo/ui/Frame.tsx";
import { SlidersIcon, TunnelIcon } from "@repo/ui/icons.tsx";
import { cx, iconButton, link } from "@repo/ui/tokens.ts";
import { useFileDrop } from "@repo/ui/use-file-drop.ts";
import { DropCover } from "./DropCover.tsx";
import { VpnList } from "./VpnList.tsx";

/** The main screen: what's on, in priority order (top wins), then everything that's off, in a fixed order. */
export function HomeScreen() {
  const app = useApp();
  const dropping = useFileDrop((files) => openDropped(app, files));
  const bar = (
    <>
      {/* No title or search box, only Settings: the list is the whole screen. */}
      <span className="flex-1" />
      <button type="button" className={iconButton} aria-label="Settings" title="Settings" onClick={() => app.push({ name: "settings" })}>
        <SlidersIcon />
      </button>
    </>
  );

  return (
    <Frame bar={bar}>
      {app.config.vpns.length === 0 ? (
        <>
          <SetupCard />
          <div className="grid gap-1 px-[var(--in)] pt-4 pb-[22px]">
            <span className="mb-1.5">
              <TunnelIcon width={36} />
            </span>
            <h2 className="text-[22px] leading-tight font-semibold">Add your first VPN</h2>
            <p className="mb-3 text-sm text-muted">Type the address you'd use in your company's VPN app. The app works out the rest.</p>
            <AddForm />
          </div>
        </>
      ) : (
        <>
          <SetupLine />
          <VpnList afterNotice={!!setupBlocker(app.docker, app.helper)} />
          <div className="flex items-center justify-between gap-3 px-[var(--in)] pt-2.5 pb-3">
            <button type="button" className={cx(link, "text-sm")} onClick={() => app.push({ name: "add" })}>
              + Add VPN
            </button>
            <button type="button" className={link} onClick={() => app.push({ name: "check" })}>
              Site not loading?
            </button>
          </div>
        </>
      )}
      {dropping && <DropCover />}
    </Frame>
  );
}
