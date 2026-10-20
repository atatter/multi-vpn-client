import { useState } from "react";
import { DOCKER_SETUP, HELPER_SETUP, SETUP_BUSY } from "../domain/setup-copy.ts";
import { useApp } from "../store/app-model.ts";
import { cell, cells, cx, groupTitle, hint, link } from "@repo/ui/tokens.ts";

/** What connecting needs, with the fixes the app can run: start Docker, install, update or remove the helper. */
export function SetupSection() {
  const app = useApp();
  const [busy, setBusy] = useState<"helper" | "docker">();
  const [error, setError] = useState<{ of: "helper" | "docker"; text: string }>();
  const helper = app.helper && (app.helper.state === "ready" ? { settings: "Installed. Connecting won't ask for your password.", action: undefined } : HELPER_SETUP[app.helper.state]);
  const run = (of: "helper" | "docker", action: () => Promise<string | undefined>) => {
    setBusy(of);
    setError(undefined);
    void action().then((problem) => {
      if (problem) setError({ of, text: problem });
      setBusy(undefined);
    });
  };
  const problem = (of: "helper" | "docker") => error?.of === of && <span className="block text-[12.5px] whitespace-pre-wrap text-danger select-text">{error.text}</span>;

  return (
    <section className="mt-5">
      <h2 className={groupTitle}>Needed to connect</h2>
      <div className={cells}>
        <div className={cell}>
          <span className="min-w-0">
            Docker
            <span className={cx(hint, app.docker !== "running" && "text-sodium")}>{busy === "docker" ? SETUP_BUSY.docker : app.docker === "running" ? "Running" : app.docker ? DOCKER_SETUP[app.docker].settings : "Checking…"}</span>
            {problem("docker")}
          </span>
          {app.docker === "stopped" && (
            <button type="button" className={link} disabled={busy === "docker"} onClick={() => run("docker", app.startDocker)}>
              {DOCKER_SETUP.stopped.action?.button}
            </button>
          )}
        </div>
        {app.helper && helper && (
          <div className={cell}>
            <span className="min-w-0">
              Network helper
              <span className={cx(hint, app.helper.state !== "ready" && "text-sodium")}>{busy === "helper" ? SETUP_BUSY.helper : helper.settings}</span>
              {app.helper.state === "not-responding" && <span className={cx(hint, "select-text")}>Log: {app.helper.logHint}</span>}
              {problem("helper")}
            </span>
            <span className="flex shrink-0 gap-3">
              {helper.action && (
                <button type="button" className={link} disabled={busy === "helper"} onClick={() => run("helper", () => app.runHelper("install"))}>
                  {helper.action.button}
                </button>
              )}
              {app.helper.state !== "not-installed" && app.helper.state !== "unsupported" && (
                <button type="button" className={cx(link, "text-danger")} disabled={busy === "helper"} onClick={() => run("helper", () => app.runHelper("uninstall"))}>
                  Uninstall
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
