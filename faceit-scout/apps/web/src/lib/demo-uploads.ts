import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const MATCH_ID = /^1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACTIVE_UPLOADS = ["AWAITING_UPLOAD", "UPLOADING", "WAITING_FOR_BATCH", "QUEUED", "DOWNLOADING", "PROCESSING"];
export const MAX_UPLOAD_BYTES = 2_000_000_000;
export const CHUNK_BYTES = 4 * 1024 * 1024;
export const uploadBatch = z.object({ demos: z.array(z.object({
  faceitMatchId: z.string().regex(MATCH_ID).transform(s => s.toLowerCase()),
  requesterNickname: z.string().trim().max(100).optional(),
  analysisId: z.string().uuid().optional(),
  matchPlayedAt: z.string().datetime({ offset: true }).nullable().optional(),
  mapName: z.string().max(64).nullable().optional(),
}).strict()).min(1).max(3) }).strict();
export class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function uploadRoot() {
  return path.resolve(process.env.DEMO_UPLOAD_DIRECTORY ?? "./data/runtime/temporary/url-imports");
}
export function fileSuffix(name: string) {
  const suffix = name.toLowerCase().match(/\.dem(?:\.zst|\.gz)?$/)?.[0];
  if (!suffix) throw new UploadError("Choose a .dem, .dem.zst or .dem.gz file.");
  return suffix;
}
export function filenameMatchId(name: string) {
  return name.match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0].toLowerCase() ?? null;
}
export async function limitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new UploadError("Missing request body.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new UploadError("Request too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
type Metadata = { name: string; size: number; fingerprint: string; suffix: string };
async function sizeOf(file: string) {
  return stat(file).then(s => s.size).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return 0; throw e; });
}
// Caller holds a database advisory lock for this job across all filesystem operations.
export async function uploadOffset(id: string) {
  return sizeOf(path.join(uploadRoot(), id + ".part"));
}
export async function recoverUpload(id: string, matchId: string) {
  const root = uploadRoot();
  let metadata: Metadata;
  try { metadata = JSON.parse(await readFile(path.join(root, id + ".json"), "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  const filename = `${matchId}_${id}${fileSuffix(metadata.name)}`;
  if (await sizeOf(path.join(root, filename)) === metadata.size) return filename;
  if (await uploadOffset(id) === metadata.size) {
    await rename(path.join(root, id + ".part"), path.join(root, filename));
    return filename;
  }
  return null;
}
export async function removeUpload(id: string, filename?: string | null) {
  for (const name of [id + ".part", id + ".json", ...(filename ? [filename] : [])]) {
    await unlink(path.join(uploadRoot(), name)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
  }
}
export function validateMagic(bytes: Buffer, suffix: string) {
  const valid = suffix === ".dem.zst" ? bytes.subarray(0,4).equals(Buffer.from([0x28,0xb5,0x2f,0xfd]))
    : suffix === ".dem.gz" ? bytes[0] === 0x1f && bytes[1] === 0x8b
    : ["PBDEMS2\0", "HL2DEMO\0"].includes(bytes.subarray(0,8).toString("ascii"));
  if (!valid) throw new UploadError("The file header does not match its demo format.");
}
export async function appendUpload(id: string, matchId: string, request: Request, chunk: Buffer) {
  const name = request.headers.get("x-file-name") ?? "";
  let decoded: string;
  try { decoded = decodeURIComponent(name); } catch { throw new UploadError("Invalid file name."); }
  const suffix = fileSuffix(decoded);
  const detected = filenameMatchId(decoded);
  if (detected && detected !== matchId) throw new UploadError("This file belongs to a different selected match.");
  const offsetHeader = request.headers.get("x-upload-offset") ?? "";
  const sizeHeader = request.headers.get("x-file-size") ?? "";
  const offset = Number(offsetHeader), size = Number(sizeHeader);
  const fingerprint = request.headers.get("x-file-fingerprint") ?? "";
  if (!/^\d+$/.test(offsetHeader) || !/^\d+$/.test(sizeHeader) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size)
      || size < 8 || size > MAX_UPLOAD_BYTES || offset < 0 || !/^[a-f0-9]{64}$/.test(fingerprint)
      || !chunk.length || chunk.length > CHUNK_BYTES || offset + chunk.length > size) throw new UploadError("Invalid upload size, offset or fingerprint.");
  const root = uploadRoot(); await mkdir(root, { recursive: true });
  const partial = path.join(root, id + ".part");
  const metadataPath = path.join(root, id + ".json");
  const metadata: Metadata = { name: decoded, size, fingerprint, suffix };
  let previous: Metadata | undefined;
  try { previous = JSON.parse(await readFile(metadataPath, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (previous && JSON.stringify(previous) !== JSON.stringify(metadata)) throw new UploadError("A different file was started for this match. Cancel it before choosing another.", 409);
  const filename = `${matchId}_${id}${suffix}`;
  // Recover a crash after rename but before the database commit.
  if (previous && await sizeOf(path.join(root, filename)) === size) return { offset: size, filename, complete: true };
  const current = await uploadOffset(id);
  if (offset !== current) throw new UploadError("Upload offset changed. Resume from the server offset.", 409);
  if (offset === 0) validateMagic(chunk, suffix);
  if (!previous) await writeFile(metadataPath, JSON.stringify(metadata), { flag: "wx" });
  const handle = await open(partial, "a");
  try { await handle.writeFile(chunk); await handle.sync(); } finally { await handle.close(); }
  const next = current + chunk.length;
  if (next === size) await rename(partial, path.join(root, filename));
  return { offset: next, filename, complete: next === size };
}
