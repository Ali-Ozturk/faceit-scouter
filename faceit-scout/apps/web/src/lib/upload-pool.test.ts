import { expect, it } from "vitest";
import { uploadTwoAtATime } from "./upload-pool";
it("starts two uploads and fills a free slot without waiting for the slower file", async () => {
  const started: number[] = [];
  const finish: Array<() => void> = [];
  const result = uploadTwoAtATime([0, 1, 2], async item => {
    started.push(item);
    await new Promise<void>(resolve => { finish[item] = resolve; });
  });
  expect(started).toEqual([0, 1]);
  finish[1]();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toEqual([0, 1, 2]);
  finish[0](); finish[2]();
  await result;
});
