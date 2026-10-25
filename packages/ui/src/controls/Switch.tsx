import { cx } from '../tokens.ts';

/**
 * On/off switch. When on, its colour says how it's going: green connected, amber on its way, red failed,
 * slate blue on but carrying nothing (a higher VPN takes it all).
 */
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  tone = 'go',
  title,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  tone?: 'go' | 'busy' | 'error' | 'standby';
  title?: string | undefined;
}) {
  const on = { go: 'bg-go-track', busy: 'bg-sodium', error: 'bg-danger', standby: 'bg-standby' }[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 [-webkit-app-region:no-drag]',
        'after:absolute after:top-[3px] after:left-[3px] after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgb(0_0_0/0.25)] after:transition-transform after:duration-150',
        'h-[22px] w-[38px] after:size-4',
        checked ? cx(on, 'after:translate-x-4') : 'bg-track',
      )}
    />
  );
}
