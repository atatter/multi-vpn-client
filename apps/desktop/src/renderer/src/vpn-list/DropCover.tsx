import { FILE_TYPES } from '../domain/provider-files.ts';
import { TunnelIcon } from '@repo/ui/icons.tsx';

export function DropCover() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 grid place-content-center justify-items-center gap-1.5 bg-surface/90 text-center font-semibold text-signal outline-2 -outline-offset-8 outline-signal outline-dashed">
      <span className="mb-1">
        <TunnelIcon width={40} />
      </span>
      Drop to add this VPN
      <span className="text-[13px] font-normal text-muted">Your provider's {FILE_TYPES} file</span>
    </div>
  );
}
