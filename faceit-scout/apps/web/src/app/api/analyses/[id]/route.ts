import { NextResponse } from "next/server";
import { getAnalysisById } from "@/db/queries/analyses";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await getAnalysisById(id);
  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  return NextResponse.json(analysis);
}
