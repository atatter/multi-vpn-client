/** Runs an operation after every one queued before it has settled. */
export type Exclusive = <T>(operation: () => Promise<T>) => Promise<T>;

/** A queue that serializes operations: each runs once the previous one settled, whether it failed or not. */
export function createQueue(): Exclusive {
  let queue: Promise<unknown> = Promise.resolve();
  return (operation) => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
}
