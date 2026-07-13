import { NextRequest, NextResponse } from "next/server";
import { getImports, isImportStatus } from "@/db/queries/imports";

export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  const rows = await getImports(status && isImportStatus(status) ? status : undefined);
  return NextResponse.json(rows);
}
