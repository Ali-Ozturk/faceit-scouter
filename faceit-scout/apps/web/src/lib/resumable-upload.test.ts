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

it("survives extended outages and caps retry delays", async () => {
  let attempts = 0;
  const wait = vi.fn().mockResolvedValue(undefined);
  const send = vi.fn(async () => {
    if (++attempts <= 12) throw new UploadRequestError("Unavailable", 503);
    return { offset: 20 };
  });
  await expect(sendChunkWithRecovery({ offset: 10, end: 20, send,
    inspect: async () => { throw new TypeError("offline"); }, wait })).resolves.toEqual({ offset: 20 });
  expect(send).toHaveBeenCalledTimes(13);
  expect(Math.max(...wait.mock.calls.map(call => call[0]))).toBe(30000);
});

it("stops retrying when paused during an outage", async () => {
  let paused = false;
  const send = vi.fn().mockRejectedValue(new TypeError("offline"));
  await expect(sendChunkWithRecovery({ offset: 0, end: 10, send,
    inspect: async () => ({ status: "UPLOADING", offset: 0 }),
    shouldStop: () => paused, wait: async () => { paused = true; } })).rejects.toThrow("paused");
  expect(send).toHaveBeenCalledTimes(1);
});

it("does not hide permanent errors behind a status lookup", async () => {
  const inspect = vi.fn();
  await expect(sendChunkWithRecovery({ offset: 0, end: 10,
    send: async () => { throw new UploadRequestError("Unauthorized", 401); }, inspect })).rejects.toThrow("Unauthorized");
  expect(inspect).not.toHaveBeenCalled();
});

it("stops retrying when the reservation has been cancelled", async () => {
  await expect(sendChunkWithRecovery({ offset: 0, end: 10,
    send: async () => { throw new TypeError("offline"); },
    inspect: async () => ({ status: "FAILED", offset: 0 }) })).rejects.toThrow("cancelled or failed");
});

it("initial connection survives more than four failures and honors pause", async () => {
  let attempts = 0;
  await expect(retryUploadRequest({ request: async () => {
    if (++attempts < 8) throw new TypeError("offline");
    return "connected";
  }, wait: async () => undefined })).resolves.toBe("connected");
  const request = vi.fn();
  await expect(retryUploadRequest({ request, shouldStop: () => true })).rejects.toThrow("paused");
  expect(request).not.toHaveBeenCalled();
});
