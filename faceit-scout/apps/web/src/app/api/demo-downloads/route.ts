import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { demoDownload, importedDemo } from "@/db/schema";
import { authorizeDemoRequest } from "@/lib/demo-downloads";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key (at least 24 characters required)." }, { status: 401 });
  // Never return signed URLs; they grant temporary access to the demo.
  const jobs = await db.select({ id: demoDownload.id, faceitMatchId: demoDownload.faceitMatchId,
    status: demoDownload.status, error: demoDownload.error, createdAt: demoDownload.createdAt,
    requesterNickname: demoDownload.requesterNickname, matchPlayedAt: demoDownload.matchPlayedAt, mapName: demoDownload.mapName,
    importId: demoDownload.importId, importStatus: importedDemo.status,
    parsedMatchId: importedDemo.parsedMatchId,
  }).from(demoDownload).leftJoin(importedDemo, eq(demoDownload.importId, importedDemo.id))
    .orderBy(desc(demoDownload.createdAt)).limit(100);
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!authorizeDemoRequest(request)) return NextResponse.json({ error: "Invalid import access key." }, { status: 401 });
  return NextResponse.json({ error: "URL imports are disabled. Download demos manually on FACEIT and upload them on Scout’s Imports page. Update your extension." }, { status: 410 });
}
