import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { demoDownload } from "@/db/schema";
import { authorizeDemoRequest } from "@/lib/demo-downloads";
import { appendUpload, CHUNK_BYTES, limitedBody, recoverUpload, removeUpload, UploadError, uploadOffset } from "@/lib/demo-uploads";
import { uploadBatchIsReady } from "@/lib/upload-batches";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context, action: "GET" | "PUT" | "DELETE") {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key." }, { status: 401 });
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new UploadError("Invalid upload ID.");
    const result = await db.transaction(async tx => {
      // Shared by upload requests, exclusive for the processor's entire lifecycle.
      // Acquire before reading the body so parsing cannot overlap upload disk work.
      if (action === "PUT") {
        const [gate] = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(hashtextextended('scout-transfer-processing', 0)) as locked`);
        if (!gate.locked) throw new UploadError("A demo is processing. Upload will resume automatically when it finishes.", 503);
      }

      // Workers hold this same job lock throughout parsing. Never queue HTTP
      // requests behind a long parse or a stalled disk write.
      const [lock] = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${id}, 0)) as locked`);
      if (!lock.locked) {
        const [current] = await tx.select({ status: demoDownload.status }).from(demoDownload).where(eq(demoDownload.id, id));
        if (action !== "DELETE" && current && ["QUEUED", "PROCESSING", "COMPLETED"].includes(current.status)) return { complete: true, status: current.status };
        throw new UploadError("Upload is busy. Retrying shortly.", 503);
      }
      const [job] = await tx.select().from(demoDownload).where(eq(demoDownload.id, id));
      if (!job) throw new UploadError("Upload not found.", 404);
      let batchLocked = false;
      async function lockBatch() {
        if (job.uploadBatchId && !batchLocked) {
          const [lock] = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${job.uploadBatchId}, 0)) as locked`);
          if (!lock.locked) throw new UploadError("Upload batch is busy. Retrying shortly.", 503);
          batchLocked = true;
        }
      }

      async function releaseBatchIfReady() {
        if (!job.uploadBatchId) {
          await tx.update(demoDownload).set({ status: "QUEUED", updatedAt: new Date() })
            .where(and(eq(demoDownload.id, id), eq(demoDownload.status, "WAITING_FOR_BATCH")));
          return "QUEUED";
        }
        const members = await tx.select({ status: demoDownload.status }).from(demoDownload)
          .where(eq(demoDownload.uploadBatchId, job.uploadBatchId));
        if (!uploadBatchIsReady(members.map(member => member.status))) return "WAITING_FOR_BATCH";
        await tx.update(demoDownload).set({ status: "QUEUED", updatedAt: new Date() })
          .where(and(eq(demoDownload.uploadBatchId, job.uploadBatchId), eq(demoDownload.status, "WAITING_FOR_BATCH")));
        return "QUEUED";
      }

      async function stageCompleted(filename: string) {
        await lockBatch();
        await tx.update(demoDownload).set({ fileName: filename, status: "WAITING_FOR_BATCH", updatedAt: new Date() })
          .where(eq(demoDownload.id, id));
        return releaseBatchIfReady();
      }

      if (action === "GET") {
        if (["AWAITING_UPLOAD", "UPLOADING"].includes(job.status)) {
          const filename = await recoverUpload(id, job.faceitMatchId);
          if (filename) {
            return { status: await stageCompleted(filename), complete: true };
          }
        }
        return { status: job.status, offset: await uploadOffset(id) };
      }
      if (!["AWAITING_UPLOAD", "UPLOADING", "WAITING_FOR_BATCH"].includes(job.status)) {
        if (action === "PUT" && ["QUEUED", "PROCESSING", "COMPLETED"].includes(job.status)) return { complete: true, status: job.status };
        throw new UploadError("This upload is no longer waiting for a file.", 409);
      }
      if (action === "DELETE") {
        await lockBatch();
        // Also recover cancellation after a crash before fileName was committed,
        // or while the metadata journal was being written.
        for (const suffix of [".dem", ".dem.zst", ".dem.gz"]) {
          await removeUpload(id, `${job.faceitMatchId}_${id}${suffix}`);
        }
        await tx.update(demoDownload).set({ status: "FAILED", error: "Upload cancelled. Open the match again to create a new upload.", updatedAt: new Date() }).where(eq(demoDownload.id, id));
        await releaseBatchIfReady();
        return { cancelled: true };
      }
      if (job.status === "WAITING_FOR_BATCH") return { complete: true, status: job.status };
      const uploaded = await appendUpload(id, job.faceitMatchId, request, await limitedBody(request, CHUNK_BYTES));
      if (uploaded.complete) return { ...uploaded, status: await stageCompleted(uploaded.filename) };
      await tx.update(demoDownload).set({ fileName: uploaded.filename, status: "UPLOADING", updatedAt: new Date() }).where(eq(demoDownload.id, id));
      return { ...uploaded, status: "UPLOADING" };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof UploadError ? e.message : "Upload interrupted. Select the same file to resume." }, { status: e instanceof UploadError ? e.status : 503 });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, "GET");
export const PUT = (request: Request, context: Context) => handle(request, context, "PUT");
export const DELETE = (request: Request, context: Context) => handle(request, context, "DELETE");
