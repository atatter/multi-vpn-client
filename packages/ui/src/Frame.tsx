import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { useFrameEnvironment } from './frame-context.ts';
import { BackIcon } from './icons.tsx';
import { actionBar, cx, iconButton } from './tokens.ts';

/**
 * The window around one screen: title bar, the app's error strip, the body and an optional action bar.
 * The title bar doubles as the window's drag handle. The window grows to fit the screen's content;
 * only when the display is too short does the body scroll, with the title and action bars staying put.
 */
export function Frame({
  title,
  onBack,
  bar,
  footer,
  children,
}: {
  /** Shown next to the back arrow. A screen that names its subject in the body can leave it out. */
  title?: string;
  /** Adds the back arrow. The main list has none and passes `bar` instead (or nothing, for an empty bar). */
  onBack?: () => void;
  bar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { platform, notice, dismissNotice, direction, fitWindow } = useFrameEnvironment();
  const parts = useRef<(HTMLElement | null)[]>([]);
  const part = (index: number) => (element: HTMLElement | null) => {
    parts.current[index] = element;
  };

  const hasNotice = !!notice;
  const hasFooter = !!footer;
  // Reports the content's natural height (not the window's), so the window can grow back after it was capped.
  useLayoutEffect(() => {
    const fit = () => fitWindow(parts.current.reduce((sum, element) => sum + (element?.offsetHeight ?? 0), 0));
    const observer = new ResizeObserver(fit);
    for (const element of parts.current) if (element) observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [hasNotice, hasFooter, fitWindow]);

  // Escape goes back, like the arrow. Prompts and inputs that handle Escape themselves stop it first.
  useEffect(() => {
    if (!onBack) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="flex max-h-screen flex-col">
      <header ref={part(0)} className="titlebar-insets flex h-11 shrink-0 items-center gap-2 border-b border-rule bg-bg [-webkit-app-region:drag]">
        {onBack === undefined ? (
          bar
        ) : (
          <>
            {/* Next to the window edge the arrow can sit in the padding; next to the traffic lights it keeps its distance. */}
            <button type="button" className={cx(iconButton, platform !== 'darwin' && '-ml-1.5')} aria-label="Back" onClick={onBack}>
              <BackIcon />
            </button>
            {title && <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>}
          </>
        )}
      </header>
      {notice && (
        <div ref={part(1)} role="alert" className="flex shrink-0 items-start justify-between gap-3 border-b border-rule bg-danger/10 px-3.5 py-2 text-[13px] text-danger">
          <span className="whitespace-pre-wrap select-text">{notice}</span>
          <button type="button" className="font-semibold" onClick={dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', direction === 'push' && 'animate-[push_170ms_ease-out]', direction === 'pop' && 'animate-[pop_170ms_ease-out]')}>
        {/* Nothing may widen the window: long names truncate or wrap, and the body never scrolls sideways. */}
        <div className="scroll-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {/* flow-root keeps the first child's top margin inside, so the measured height is the real one. */}
          <div ref={part(2)} className="flow-root">
            {children}
          </div>
        </div>
        {footer && (
          <footer ref={part(3)} className={cx(actionBar, 'shrink-0')}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
