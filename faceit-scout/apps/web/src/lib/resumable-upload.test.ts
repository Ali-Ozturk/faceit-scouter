import { expect, it, vi } from "vitest";
import { retryUploadRequest, sendChunkWithRecovery, UploadRequestError } from "./resumable-upload";

it("retries the initial resume-state request when the VPS is temporarily unavailable", async () => {
  const request = vi.fn()
    .mockRejectedValueOnce(new UploadRequestError("Gateway timeout", 504))
    .mockResolvedValue({ status: "AWAITING_UPLOAD", offset: 0 });

  await expect(retryUploadRequest({ request, wait: async () => undefined })).resolves.toEqual({ status: "AWAITING_UPLOAD", offset: 0 });
  expect(request).toHaveBeenCalledTimes(2);
});

it("retries transient upload failures with backoff", async () => {
  const send = vi.fn()
    .mockRejectedValueOnce(new UploadRequestError("Unavailable", 503))
    .mockResolvedValue({ offset: 20 });
  const wait = vi.fn().mockResolvedValue(undefined);

  await expect(sendChunkWithRecovery({ offset: 10, end: 20, send, inspect: async () => ({ status: "UPLOADING", offset: 10 }), wait }))
    .resolves.toEqual({ offset: 20 });
  expect(send).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledWith(1000);
});

it("uses the server offset when a response was lost after the chunk was saved", async () => {
  const send = vi.fn().mockRejectedValue(new TypeError("network interrupted"));

  await expect(sendChunkWithRecovery({ offset: 10, end: 20, send, inspect: async () => ({ status: "UPLOADING", offset: 20 }) }))
    .resolves.toEqual({ complete: false, offset: 20 });
  expect(send).toHaveBeenCalledTimes(1);
});

it("recognizes a completed upload staged behind its batch when the final response is lost", async () => {
  const send = vi.fn().mockRejectedValue(new TypeError("network interrupted"));

  await expect(sendChunkWithRecovery({ offset: 10, end: 20, send, inspect: async () => ({ status: "WAITING_FOR_BATCH", offset: 0 }) }))
    .resolves.toEqual({ complete: true, offset: 20, status: "WAITING_FOR_BATCH" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("does not retry permanent validation failures", async () => {
  const send = vi.fn().mockRejectedValue(new UploadRequestError("Wrong file", 400));

  await expect(sendChunkWithRecovery({ offset: 10, end: 20, send, inspect: async () => ({ status: "UPLOADING", offset: 10 }) }))
    .rejects.toThrow("Wrong file");
  expect(send).toHaveBeenCalledTimes(1);
});
