import { parseSite } from "@repo/core";
import { useEffect, useState } from "react";
import { vpnLabel } from "../domain/labels.ts";
import { useApp } from "../store/app-model.ts";
import { Frame } from "@repo/ui/Frame.tsx";
import { cx, input, link, mono } from "@repo/ui/tokens.ts";

/** The site part of whatever was pasted: "https://jira.example.com/browse/ABC-1" → "jira.example.com"; undefined for text that isn't one. */
const siteOf = (text: string) => parseSite(text)?.site;

/** One question, one answer: does this site go through a VPN, and which one (a link to it). */
export function CheckScreen({ query = "" }: { query?: string | undefined }) {
  const app = useApp();
  const { api } = app;
  const [text, setText] = useState(() => siteOf(query) ?? query);
  const [answer, setAnswer] = useState<{ text: string; site: string | null; vpnId: string | null }>();
  const typed = text.trim();

  useEffect(() => {
    if (!typed) return;
    let current = true;
    const timer = setTimeout(() => {
      void api.checkRoute(typed).then((result) => current && setAnswer({ text: typed, site: result.site, vpnId: "vpnId" in result ? result.vpnId : null }));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed, app.connections, api]);

  const shown = answer?.text === typed ? answer : undefined;
  const via = shown?.vpnId ? app.config.vpns.find((vpn) => vpn.id === shown.vpnId) : undefined;
  return (
    <Frame title="Site not loading?" onBack={app.back}>
      {/* One 14px rhythm around the box and the answer; the label sits tight to its box. */}
      <div className="px-[var(--in)] py-3.5">
        <label className="grid min-w-0 gap-1.5">
          <span className="text-[13px] font-semibold">Paste the link or address</span>
          <input
            className={cx(input(), mono, "h-10 text-[15.5px]")}
            value={text}
            autoFocus
            placeholder="https://jira.client-b.internal/browse/…"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            // A pasted link keeps only its site: the path doesn't change where it goes.
            onPaste={(event) => {
              const pasted = siteOf(event.clipboardData.getData("text"));
              if (!pasted) return;
              event.preventDefault();
              setText(pasted);
            }}
            onBlur={() => setText(siteOf(typed) ?? text)}
          />
        </label>
        {shown && shown.site === null && <p className="mt-3.5 text-[12.5px] text-muted">That doesn't look like a link, host or IP address.</p>}
        {shown?.site && (
          <p className={cx("mt-3.5 text-[15px] leading-snug", !via && "text-muted")} aria-live="polite">
            {via ? (
              <>
                Goes through{" "}
                <button type="button" className={cx(link, "text-[15px] hover:underline hover:underline-offset-3")} onClick={() => app.push({ name: "vpn", vpnId: via.id })}>
                  {vpnLabel(via)}
                </button>
              </>
            ) : (
              "Doesn't go through a VPN"
            )}
          </p>
        )}
      </div>
    </Frame>
  );
}
