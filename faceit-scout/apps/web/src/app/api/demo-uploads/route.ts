import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { demoDownload } from "@/db/schema";
import { authorizeDemoRequest, hasQueueCapacity } from "@/lib/demo-downloads";
import { ACTIVE_UPLOADS, limitedBody, uploadBatch, UploadError } from "@/lib/demo-uploads";
export { GET } from "../demo-downloads/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key." }, { status: 401 });
  try {
    let body: unknown;
    try { body = JSON.parse((await limitedBody(request, 40000)).toString("utf8")); }
    catch (e) { if (e instanceof UploadError) throw e; throw new UploadError("Invalid JSON."); }
    const parsed = uploadBatch.safeParse(body);
    if (!parsed.success) throw new UploadError("Select 1–3 valid FACEIT match IDs. Demo URLs are not accepted.");
    const demos = [...new Map(parsed.data.demos.map(d => [d.faceitMatchId, d])).values()];
    const jobs = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(73190421)`);
      const active = await tx.select().from(demoDownload).where(inArray(demoDownload.status, ACTIVE_UPLOADS));
      if (!hasQueueCapacity(active.map(j => j.faceitMatchId), demos.map(d => d.faceitMatchId))) throw new UploadError("Nine imports are pending. Complete or cancel an upload first.", 409);
      const uploadBatchId = randomUUID();
      for (const demo of demos.filter(d => !active.some(a => a.faceitMatchId === d.faceitMatchId))) {
        await tx.insert(demoDownload).values({ faceitMatchId: demo.faceitMatchId, uploadBatchId, status: "AWAITING_UPLOAD",
          requesterNickname: demo.requesterNickname, mapName: demo.mapName,
          matchPlayedAt: demo.matchPlayedAt ? new Date(demo.matchPlayedAt) : null });
      }
      return tx.select({ id: demoDownload.id, faceitMatchId: demoDownload.faceitMatchId, status: demoDownload.status })
        .from(demoDownload).where(and(inArray(demoDownload.faceitMatchId, demos.map(d => d.faceitMatchId)), inArray(demoDownload.status, ACTIVE_UPLOADS)));
    });
    return NextResponse.json({ jobs }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof UploadError ? e.message : "Upload queue unavailable." }, { status: e instanceof UploadError ? e.status : 503 });
  }
}
