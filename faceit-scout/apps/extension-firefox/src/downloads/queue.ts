export type QueueProgress<T, R> = {
  item: T;
  result?: R;
  error?: Error;
};

export async function runBoundedQueue<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
  onProgress?: (progress: QueueProgress<T, R>) => void,
) {
  const uniqueItems = [...items];
  const results: Array<R | undefined> = new Array(uniqueItems.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, uniqueItems.length || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < uniqueItems.length) {
      const index = cursor;
      cursor += 1;
      const item = uniqueItems[index];
      try {
        const result = await worker(item);
        results[index] = result;
        onProgress?.({ item, result });
      } catch (error) {
        onProgress?.({ item, error: error instanceof Error ? error : new Error("Unknown queue error") });
      }
    }
  }));

  return results;
}
