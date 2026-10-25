/** Decimal MB, as the tray's update item counts the same archive. */
const MB = 1e6;

/**
 * "120 MB downloaded, 140 MB left" for a `size`-byte archive that's `share` (0 to 1) downloaded. Once it's all
 * there, it says the archive is being unpacked, which takes a while on Windows.
 */
export function progressText(share: number, size: number): string {
  const total = Math.round(size / MB);
  const downloaded = Math.min(total, Math.floor((share * size) / MB));
  return share >= 1
    ? `${total} MB downloaded, unpacking…`
    : `${downloaded} MB downloaded, ${total - downloaded} MB left`;
}

/**
 * The launcher's messages. On a terminal the download counter rewrites one line in place; when the stream is piped
 * it's left out rather than printed hundreds of times. A message after the counter starts on the next line.
 */
export function terminalOutput(stream: Pick<NodeJS.WriteStream, 'write' | 'isTTY'>) {
  let counter: string | undefined;
  return {
    log(line: string) {
      stream.write(`${counter === undefined ? '' : '\n'}${line}\n`);
      counter = undefined;
    },
    progress(share: number, size: number) {
      const text = progressText(share, size);
      if (!stream.isTTY || text === counter) {
        return;
      }

      stream.write(`\r${text}\x1b[K`);
      counter = text;
    },
  };
}
