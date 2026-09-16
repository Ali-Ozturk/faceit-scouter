import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { demoDownload } from "@/db/schema";
import { authorizeDemoRequest } from "@/lib/demo-downloads";
import { appendUpload, CHUNK_BYTES, limitedBody, recoverUpload, removeUpload, UploadError, uploadOffset } from "@/lib/demo-uploads";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context, action: "GET" | "PUT" | "DELETE") {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key." }, { status: 401 });
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new UploadError("Invalid upload ID.");
    // Bound each chunk before holding a transaction/connection during disk work.
    const chunk = action === "PUT" ? await limitedBody(request, CHUNK_BYTES) : undefined;
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
      const [job] = await tx.select().from(demoDownload).where(eq(demoDownload.id, id));
      if (!job) throw new UploadError("Upload not found.", 404);
      if (action === "GET") {
        if (["AWAITING_UPLOAD", "UPLOADING"].includes(job.status)) {
          const filename = await recoverUpload(id, job.faceitMatchId);
          if (filename) {
            await tx.update(demoDownload).set({ fileName: filename, status: "QUEUED", updatedAt: new Date() }).where(eq(demoDownload.id, id));
            return { status: "QUEUED", complete: true };
          }
        }
        return { status: job.status, offset: await uploadOffset(id) };
      }
      if (!["AWAITING_UPLOAD", "UPLOADING"].includes(job.status)) {
        if (action === "PUT" && ["QUEUED", "PROCESSING", "COMPLETED"].includes(job.status)) return { complete: true, status: job.status };
        throw new UploadError("This upload is no longer waiting for a file.", 409);
      }
      if (action === "DELETE") {
        // Also recover cancellation after a crash before fileName was committed,
        // or while the metadata journal was being written.
        for (const suffix of [".dem", ".dem.zst", ".dem.gz"]) {
          await removeUpload(id, `${job.faceitMatchId}_${id}${suffix}`);
        }
        await tx.update(demoDownload).set({ status: "FAILED", error: "Upload cancelled. Open the match again to create a new upload.", updatedAt: new Date() }).where(eq(demoDownload.id, id));
        return { cancelled: true };
      }
      const uploaded = await appendUpload(id, job.faceitMatchId, request, chunk!);
      await tx.update(demoDownload).set({ fileName: uploaded.filename, status: uploaded.complete ? "QUEUED" : "UPLOADING", updatedAt: new Date() }).where(eq(demoDownload.id, id));
      return uploaded;
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof UploadError ? e.message : "Upload interrupted. Select the same file to resume." }, { status: e instanceof UploadError ? e.status : 503 });
  }
}
export const GET = (request: Request, context: Context) => handle(request, context, "GET");
export const PUT = (request: Request, context: Context) => handle(request, context, "PUT");
export const DELETE = (request: Request, context: Context) => handle(request, context, "DELETE");
