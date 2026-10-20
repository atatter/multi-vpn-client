import { useApp } from "../store/app-model.ts";
import { Frame } from "@repo/ui/Frame.tsx";
import { ChevronIcon } from "@repo/ui/icons.tsx";
import { cell, cells, cx, groupTitle, hint } from "@repo/ui/tokens.ts";
import { SetupSection } from "./SetupSection.tsx";
import { StorageSection } from "./StorageSection.tsx";

/** Settings only holds settings: help, what connecting needs, where things are stored, the version. */
export function SettingsScreen() {
  const app = useApp();
  const row = cx(cell, "hover:bg-[color-mix(in_srgb,var(--field)_94%,var(--ink))]");
  return (
    <Frame title="Settings" onBack={app.back}>
      <div className="px-[var(--in)] pt-3 pb-[18px]">
        <section>
          <h2 className={groupTitle}>Help</h2>
          <div className={cells}>
            <button type="button" className={row} onClick={() => app.push({ name: "traffic" })}>
              <span>
                Where traffic goes
                <span className={hint}>What each VPN carried in the last 5 minutes</span>
              </span>
              <ChevronIcon className="text-off" />
            </button>
            <button type="button" className={row} onClick={() => app.push({ name: "check" })}>
              <span>
                Site not loading?
                <span className={hint}>See which VPN a site goes through</span>
              </span>
              <ChevronIcon className="text-off" />
            </button>
          </div>
        </section>
        <SetupSection />
        <StorageSection />
        <section className="mt-5">
          <h2 className={groupTitle}>About</h2>
          <div className={cells}>
            <div className={cell}>
              <span>
                Version {app.info.version}
                {!app.info.packaged && <span className={hint}>Development build, run from source</span>}
              </span>
            </div>
          </div>
        </section>
      </div>
    </Frame>
  );
}
