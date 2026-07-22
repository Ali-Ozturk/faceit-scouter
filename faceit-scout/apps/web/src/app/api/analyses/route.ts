import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnalysis } from "@/db/queries/analyses";
import { createFaceitClientFromEnv, FaceitHttpError } from "@/lib/faceit/client";
import { discoverFaceitMatches, normalizeMapName } from "@/lib/faceit/discovery";

const createAnalysisSchema = z.object({
  faceitMatchId: z.string().trim().min(1),
  requestingPlayerFaceitId: z.string().trim().min(1),
  selectedMap: z.string().trim().optional().nullable(),
  minimumSharedPlayers: z.number().int().min(3).max(5).optional(),
});

export async function POST(request: Request) {
  const parsed = createAnalysisSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid analysis request." }, { status: 400 });
  }

  try {
    const faceitClient = createFaceitClientFromEnv();
    const requestingPlayerFaceitId = await faceitClient.resolvePlayerId(parsed.data.requestingPlayerFaceitId);
    const input = {
      faceitMatchId: parsed.data.faceitMatchId,
      requestingPlayerFaceitId,
      selectedMap: normalizeMapName(parsed.data.selectedMap),
      minimumSharedPlayers: parsed.data.minimumSharedPlayers ?? 4,
    };
    const result = await discoverFaceitMatches(faceitClient, input, { minimumSharedPlayers: input.minimumSharedPlayers });
    const stored = await createAnalysis(input, result);
    return NextResponse.json(stored, { status: 201 });
  } catch (error) {
    const status = error instanceof FaceitHttpError ? faceitStatusToHttpStatus(error.status) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status });
  }
}

function faceitStatusToHttpStatus(status: number) {
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 404;
  if (status === 429) return 429;
  return status >= 500 ? 502 : 400;
}
