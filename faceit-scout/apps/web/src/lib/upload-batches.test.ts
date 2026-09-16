import { describe, expect, it } from "vitest";
import { uploadBatchIsReady } from "./upload-batches";

describe("uploadBatchIsReady", () => {
  it("waits while another file has not finished", () => {
    expect(uploadBatchIsReady(["WAITING_FOR_BATCH", "UPLOADING", "AWAITING_UPLOAD"])).toBe(false);
  });

  it("releases all completed files together", () => {
    expect(uploadBatchIsReady(["WAITING_FOR_BATCH", "WAITING_FOR_BATCH", "WAITING_FOR_BATCH"])).toBe(true);
  });

  it("does not let a cancelled reservation block completed files", () => {
    expect(uploadBatchIsReady(["WAITING_FOR_BATCH", "FAILED"])).toBe(true);
  });
});
