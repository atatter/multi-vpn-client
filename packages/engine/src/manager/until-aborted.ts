/**
 * Settles like `work`, or rejects with the abort reason as soon as `signal` aborts (the work itself carries on).
 * `work` always gets a handler, so its failure after an abort is never an unhandled rejection.
 */
export const untilAborted = <T>(work: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    if (signal.aborted) onAbort();
  });
