/** Small line icons. Decorative: the buttons that hold them carry the label. */

export const SlidersIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M2 4.5h7M13 4.5h1M2 11.5h1M7 11.5h7" />
    <circle cx="11" cy="4.5" r="2" />
    <circle cx="5" cy="11.5" r="2" />
  </svg>
);

export const DownloadIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5" />
  </svg>
);

export const RestartIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1M13.5 2.5v3.25h-3.25" />
  </svg>
);

export const BackIcon = () => (
  <svg
    width="10"
    height="16"
    viewBox="0 0 10 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M8 2L2 8l6 6" />
  </svg>
);

export const ChevronIcon = ({ className }: { className?: string }) => (
  <svg
    width="8"
    height="12"
    viewBox="0 0 8 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
    className={className}
  >
    <path d="M2 2l4 4-4 4" />
  </svg>
);

export const GripIcon = () => (
  <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">
    <circle cx="4" cy="4" r="1.6" />
    <circle cx="10" cy="4" r="1.6" />
    <circle cx="4" cy="10" r="1.6" />
    <circle cx="10" cy="10" r="1.6" />
    <circle cx="4" cy="16" r="1.6" />
    <circle cx="10" cy="16" r="1.6" />
  </svg>
);

/**
 * The app's mark in empty states and drop zones: a tunnel carrying three lanes, the glyph of apps/desktop/resources/icon.svg.
 * Colours are fixed, so it looks like the app icon wherever it's placed.
 */
export const TunnelIcon = ({ width = 44 }: { width?: number }) => (
  <svg
    width={width}
    height={(width * 46) / 48}
    viewBox="8 9 48 46"
    fill="none"
    strokeWidth="7.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 51V33a20 20 0 0 1 40 0V51" className="stroke-signal" />
    <path d="M22 51v-7" className="stroke-go" />
    <path d="M32 51v-12" className="stroke-sodium" />
    <path d="M42 51v-7" className="stroke-signal" />
  </svg>
);

export const LockIcon = () => (
  <svg
    width="12"
    height="14"
    viewBox="0 0 12 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="1.5" y="6" width="9" height="7" rx="1.5" />
    <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

export const XIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M2 2l6 6M8 2L2 8" />
  </svg>
);

/** A pin: an address that goes through one VPN whatever the order. */
export const PinIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    aria-hidden="true"
    className="inline align-[-1px]"
  >
    <path d="M4.5 1.5h3l-.5 3 2 2H3l2-2-.5-3ZM6 6.5V11" />
  </svg>
);
