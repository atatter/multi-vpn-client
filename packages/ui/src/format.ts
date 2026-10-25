const KB = 1000;

export const fmtBytes = (bytes: number) => {
  if (bytes < KB) {
    return `${bytes} B`;
  }
  return bytes < KB * KB ? `${Math.round(bytes / KB)} KB` : `${(bytes / KB / KB).toFixed(1)} MB`;
};

export const fmtRate = (bytes: number) => `${fmtBytes(bytes)}/s`;

/** Average over the last few seconds, so a quiet second doesn't flash "0 B/s". */
export const smoothRate = (series: readonly number[] | undefined) => {
  const recent = (series ?? []).slice(-4);
  return recent.length
    ? Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length)
    : 0;
};

/** "a, b and c" */
export const listOf = (items: readonly string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
