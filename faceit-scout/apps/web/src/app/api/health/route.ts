import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch (error) {
    return NextResponse.json({ ok: false, database: "unreachable", error: String(error) }, { status: 503 });
  }
}
