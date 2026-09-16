import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendUpload, CHUNK_BYTES, filenameMatchId, limitedBody, recoverUpload, removeUpload, uploadBatch, uploadOffset, validateMagic } from "./demo-uploads";
let root: string;
const id = "a2345678-1234-4234-8234-123456789abc";
const match = "1-12345678-1234-4234-8234-123456789abc";
const demo = Buffer.from("PBDEMS2\0test-demo-content");
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "scout-upload-")); vi.stubEnv("DEMO_UPLOAD_DIRECTORY", root); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive:true, force:true }); });
function request(offset=0, extra: Record<string,string> = {}) {
  return new Request("http://localhost/upload", { method:"PUT", headers: { "x-file-name": match + ".dem", "x-file-size": String(demo.length), "x-upload-offset": String(offset), "x-file-fingerprint": "a".repeat(64), ...extra } });
}
it("keeps partial files out of processing and resumes with an atomic final rename", async () => {
  expect(await appendUpload(id, match, request(), demo.subarray(0,10))).toMatchObject({ offset:10, complete:false });
  expect(await uploadOffset(id)).toBe(10);
  await expect(stat(path.join(root, `${match}_${id}.dem`))).rejects.toThrow();
  const result = await appendUpload(id, match, request(10), demo.subarray(10));
  expect(result.complete).toBe(true);
  expect(await readFile(path.join(root,result.filename))).toEqual(demo);
  expect(await appendUpload(id, match, request(10), demo.subarray(10))).toEqual(result);
});
it("rejects mismatched match IDs, changed files, and stale offsets without corrupting the partial", async () => {
  await expect(appendUpload(id, match, request(0,{"x-file-name":"1-aaaaaaaa-1234-4234-8234-123456789abc.dem"}), demo)).rejects.toThrow("different selected match");
  await appendUpload(id,match,request(),demo.subarray(0,10));
  await expect(appendUpload(id,match,request(10,{"x-file-fingerprint":"b".repeat(64)}),demo.subarray(10))).rejects.toThrow("different file");
  await expect(appendUpload(id,match,request(),demo)).rejects.toThrow("offset changed");
  expect(await uploadOffset(id)).toBe(10);
});
it("rejects oversized uploads and invalid file signatures before writing", async () => {
  await expect(appendUpload(id,match,request(0,{"x-file-size":"2000000001"}),demo)).rejects.toThrow("Invalid upload");
  await expect(appendUpload(id,match,request(),Buffer.from("notademo"))).rejects.toThrow("header");
  expect(await uploadOffset(id)).toBe(0);
  expect(() => validateMagic(Buffer.from([0x28,0xb5,0x2f,0xfd]), ".dem.zst")).not.toThrow();
  expect(() => validateMagic(Buffer.from([0x1f,0x8b]), ".dem.gz")).not.toThrow();
});
it("cancels partial uploads and permits a fresh start", async () => {
  await appendUpload(id,match,request(),demo.subarray(0,10));
  await removeUpload(id);
  expect(await uploadOffset(id)).toBe(0);
  expect((await appendUpload(id,match,request(),demo)).complete).toBe(true);
});
it("bounds streamed bodies independently of Content-Length", async () => {
  const body = new Request("http://localhost", {method:"PUT",body:Buffer.alloc(CHUNK_BYTES+1)});
  await expect(limitedBody(body,CHUNK_BYTES)).rejects.toThrow("too large");
});
it("rejects URL payloads and unsafe IDs and never guesses by file order", () => {
  expect(uploadBatch.safeParse({ demos:[{faceitMatchId:match,url:"https://example.com/demo"}] }).success).toBe(false);
  expect(uploadBatch.safeParse({ demos:[{faceitMatchId:"../../escape"}] }).success).toBe(false);
  expect(filenameMatchId("renamed.dem")).toBeNull();
  expect(filenameMatchId(match.toUpperCase()+".dem.zst")).toBe(match);
});
it("recovers crashes before or after the final rename without uploading again", async () => {
  const result = await appendUpload(id,match,request(),demo);
  expect(await recoverUpload(id,match)).toBe(result.filename);
  await rename(path.join(root,result.filename),path.join(root,id+'.part'));
  expect(await recoverUpload(id,match)).toBe(result.filename);
  expect(await readFile(path.join(root,result.filename))).toEqual(demo);
});
