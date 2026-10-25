import { useRef } from 'react';
import { FILE_EXTENSIONS, FILE_TYPES } from '../domain/provider-files.ts';
import { useApp } from '../store/app-model.ts';
import { openProfile } from '../store/import-profile.ts';
import { cx, input, link, mono, primary } from '@repo/ui/tokens.ts';
import { DetectionLine } from './DetectionLine.tsx';
import { KindPicker } from './KindPicker.tsx';
import { useAddress } from './use-address.ts';

/**
 * The address box with what was found, a file instead, and picking the type yourself as the fallback.
 * `withContinue`: a Continue button right under the address (first launch has no action bar).
 */
export function AddressFields({
  state,
  autoFocus,
  withContinue = false,
}: {
  state: ReturnType<typeof useAddress>;
  autoFocus: boolean;
  withContinue?: boolean;
}) {
  const app = useApp();
  const openFile = (file: File) => openProfile(app, file);
  const picker = useRef<HTMLInputElement>(null);
  const { address, setAddress, typed, checking, detection, manual, setManual, next } = state;

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          next?.();
        }}
      >
        <input
          className={cx(input(), mono, 'h-10 text-[15.5px]')}
          value={address}
          placeholder="vpn.example.com"
          aria-label="VPN address"
          spellCheck={false}
          autoFocus={autoFocus}
          onChange={(event) => setAddress(event.target.value)}
        />
      </form>
      <DetectionLine checking={checking} typed={typed} detection={detection} />
      {withContinue && (
        <button
          type="button"
          className={cx(primary, 'mt-3 w-full')}
          disabled={!next}
          onClick={next}
        >
          Continue
        </button>
      )}
      <div className="my-3.5 flex items-center gap-2.5 text-[12.5px] text-muted before:h-px before:flex-1 before:bg-rule after:h-px after:flex-1 after:bg-rule">
        or
      </div>
      <div className="rounded-[9px] border-[1.5px] border-dashed border-track px-3 py-2.5 text-center text-[13.5px] text-muted">
        Drop your provider's <b className="text-ink">{FILE_TYPES}</b> file, or{' '}
        <button
          type="button"
          className={cx(link, 'text-[13.5px]')}
          onClick={() => picker.current?.click()}
        >
          choose a file
        </button>
        <input
          ref={picker}
          type="file"
          accept={FILE_EXTENSIONS.join(',')}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              openFile(file);
            }

            event.target.value = '';
          }}
        />
      </div>
      {manual ? (
        <KindPicker onChooseFile={() => picker.current?.click()} />
      ) : (
        <button type="button" className={cx(link, 'mt-3.5')} onClick={() => setManual(true)}>
          Know the type? Pick it yourself
        </button>
      )}
    </>
  );
}
