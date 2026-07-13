import { NextResponse } from "next/server";
import { getTeamMap } from "@/db/queries/teams";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; mapName: string }> }) {
  const { id, mapName } = await params;
  const row = await getTeamMap(id, decodeURIComponent(mapName));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
