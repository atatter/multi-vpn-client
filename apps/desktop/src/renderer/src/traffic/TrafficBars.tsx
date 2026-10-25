/**
 * The last minute as a tally: one bar per 2 seconds, standing on a baseline, so "how much went through"
 * reads at a glance. Older bars recede, the current one is solid; quiet moments stay as a sliver of baseline.
 */
export function TrafficBars({ rates = [] }: { rates?: readonly number[] }) {
  // Right-aligned: the newest second is always the last bar, even before a full minute has passed.
  const seconds = [...Array<number>(Math.max(0, 60 - rates.length)).fill(0), ...rates.slice(-60)];
  const bars = Array.from({ length: 30 }, (_, index) => (seconds[index * 2] ?? 0) + (seconds[index * 2 + 1] ?? 0));
  const max = Math.max(1, ...bars) * 1.08;
  return (
    <svg className="block h-9 w-full" viewBox="0 0 300 36" preserveAspectRatio="none" role="img" aria-label="Traffic over the last minute">
      {bars.map((value, index) => {
        const height = Math.max(1.5, (value / max) * 34);
        const now = index === bars.length - 1;
        return <rect key={index} x={index * 10 + 1} y={36 - height} width={8} height={height} rx={1.5} className={now ? 'fill-go' : 'fill-go/45 dark:fill-go/55'} />;
      })}
    </svg>
  );
}
