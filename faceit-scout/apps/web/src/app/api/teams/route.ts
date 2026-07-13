import { NextResponse } from "next/server";
import { getTeams } from "@/db/queries/teams";

export async function GET() {
  return NextResponse.json(await getTeams());
}
