// Keep both transfer slots busy without starting every selected file at once.
export async function uploadTwoAtATime<T>(items: T[], upload: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await upload(items[index], index);
    }
  }));
}
