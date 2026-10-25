import { useRef, useState } from 'react';
import { SavedValue } from '@repo/ui/controls/SavedValue.tsx';
import { cx, hint, label, mono, secondary } from '@repo/ui/tokens.ts';
import { OPENVPN_FILE } from './kind.ts';

/** The .ovpn profile: servers and certificates come from it, so it's imported rather than typed. */
export function ProfileField({
  remotes,
  hasProfile,
  error,
  onImport,
}: {
  remotes: readonly string[];
  hasProfile: boolean;
  error: string | undefined;
  /** Applies the file's text to the VPN; returns why it can't be used, if it can't. */
  onImport: (text: string) => string | undefined;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string>();
  const read = async (file: File) => {
    const error = onImport(await file.text());
    // Worded like a dropped file's (renderer: store/import-profile.ts).
    setProblem(error && `${file.name} isn't a valid OpenVPN file: ${error}`);
  };
  const shown = problem ?? error;
  return (
    <div className="mb-3 grid gap-1">
      <span className={label}>Profile</span>
      {hasProfile && remotes.length > 0 ? (
        <SavedValue onReplace={() => picker.current?.click()}>
          <span className={cx(mono, 'truncate')}>{remotes.join(', ')}</span>
        </SavedValue>
      ) : (
        <div>
          <button type="button" className={secondary} onClick={() => picker.current?.click()}>
            Choose .ovpn file
          </button>
        </div>
      )}
      {shown ? (
        <span className="text-[12.5px] text-danger select-text">{shown}</span>
      ) : hasProfile ? (
        <span className={hint}>Servers and certificates come from this file.</span>
      ) : (
        <span className={cx(hint, 'text-sodium')}>
          Needed to connect: servers and certificates come from this file.
        </span>
      )}
      <input
        ref={picker}
        type="file"
        accept={OPENVPN_FILE.extensions.join(',')}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
