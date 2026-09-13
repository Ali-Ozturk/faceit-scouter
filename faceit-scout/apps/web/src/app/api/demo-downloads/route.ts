import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { demoDownload, importedDemo } from "@/db/schema";
import { authorizeDemoRequest, demoRequest } from "@/lib/demo-downloads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key (at least 24 characters required)." }, { status: 401 });
  // Never return signed URLs; they grant temporary access to the demo.
  const jobs = await db.select({ id: demoDownload.id, faceitMatchId: demoDownload.faceitMatchId,
    status: demoDownload.status, error: demoDownload.error, createdAt: demoDownload.createdAt,
    importId: demoDownload.importId, importStatus: importedDemo.status,
    parsedMatchId: importedDemo.parsedMatchId,
  }).from(demoDownload).leftJoin(importedDemo, eq(demoDownload.importId, importedDemo.id))
    .orderBy(desc(demoDownload.createdAt)).limit(100);
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key (at least 24 characters required)." }, { status: 401 });
  // Bound the streamed body as well as Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Missing request body." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 40000) { await reader.cancel(); return NextResponse.json({ error: "Request too large." }, { status: 413 }); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const parsed = demoRequest.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Send 1–3 demos with valid match IDs and approved HTTPS demo URLs." }, { status: 400 });
  const demos = [...new Map(parsed.data.demos.map(d => [d.faceitMatchId, d])).values()];
  const result = await db.transaction(async tx => {
    // Serializes admission across requests and web instances.
    await tx.execute(sql`select pg_advisory_xact_lock(73190421)`);
    const active = await tx.select().from(demoDownload).where(inArray(demoDownload.status, ["QUEUED", "DOWNLOADING", "PROCESSING"]));
    const additions = demos.filter(d => !active.some(a => a.faceitMatchId === d.faceitMatchId));
    if (active.length + additions.length > 3) return null;
    if (additions.length) await tx.insert(demoDownload).values(additions.map(d => ({ faceitMatchId: d.faceitMatchId, signedUrl: d.url })));
    return tx.select({ id: demoDownload.id, faceitMatchId: demoDownload.faceitMatchId, status: demoDownload.status })
      .from(demoDownload).where(and(inArray(demoDownload.faceitMatchId, demos.map(d => d.faceitMatchId)), inArray(demoDownload.status, ["QUEUED", "DOWNLOADING", "PROCESSING"])));
  }).catch(() => undefined); // Do not log DB exception parameters containing signed URLs.
  if (result === undefined) return NextResponse.json({ error: "Import queue unavailable. Try again shortly." }, { status: 503 });
  if (!result) return NextResponse.json({ error: "Three demos are already queued or processing. Wait for a slot to finish." }, { status: 409 });
  return NextResponse.json({ jobs: result }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
