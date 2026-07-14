import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  csMatch,
  faceitAnalysis,
  faceitAnalysisCandidate,
  faceitAnalysisOpponent,
} from "@/db/schema";
import type { DiscoveryCandidate, DiscoveryInput, DiscoveryResult, FaceitPlayer } from "@/lib/faceit/discovery";

export type StoredAnalysis = {
  analysisId: string;
  faceitMatchId: string;
  requestingPlayerFaceitId: string;
  selectedMap: string | null;
  opponentFaction: string;
  createdAt: Date;
  opponents: FaceitPlayer[];
  candidates: StoredCandidate[];
  warnings?: string[];
};

export type StoredCandidate = {
  faceitMatchId: string;
  map: string | null;
  sharedPlayerCount: number;
  sharedPlayers: FaceitPlayer[];
  playedAt: Date | null;
  faceitMatchroomUrl: string;
  processed: boolean;
  processedMatchId: string | null;
};

export async function createAnalysis(input: DiscoveryInput, result: DiscoveryResult) {
  const processedByFaceitId = await findProcessedMatches(result.candidates.map((candidate) => candidate.faceitMatchId));
  const [analysis] = await db
    .insert(faceitAnalysis)
    .values({
      faceitMatchId: input.faceitMatchId,
      requestingPlayerFaceitId: input.requestingPlayerFaceitId,
      selectedMap: input.selectedMap ?? null,
      opponentFaction: result.opponentFaction,
    })
    .returning();

  if (result.opponents.length > 0) {
    await db.insert(faceitAnalysisOpponent).values(result.opponents.map((opponent) => ({
      analysisId: analysis.id,
      faceitPlayerId: opponent.faceitPlayerId,
      nickname: opponent.nickname,
    })));
  }

  if (result.candidates.length > 0) {
    await db.insert(faceitAnalysisCandidate).values(result.candidates.map((candidate) => ({
      analysisId: analysis.id,
      faceitMatchId: candidate.faceitMatchId,
      mapName: candidate.map,
      sharedPlayerCount: candidate.sharedPlayerCount,
      sharedPlayersJson: candidate.sharedPlayers,
      playedAt: candidate.playedAt,
      faceitMatchroomUrl: candidate.faceitMatchroomUrl,
      processedMatchId: processedByFaceitId.get(candidate.faceitMatchId) ?? null,
    })));
  }

  return toStoredAnalysis(analysis, result.opponents, result.candidates, processedByFaceitId, result.warnings);
}

export async function getAnalysisById(id: string): Promise<StoredAnalysis | null> {
  const [analysis] = await db.select().from(faceitAnalysis).where(eq(faceitAnalysis.id, id)).limit(1);
  if (!analysis) return null;

  const opponents = await db
    .select()
    .from(faceitAnalysisOpponent)
    .where(eq(faceitAnalysisOpponent.analysisId, id));
  const candidateRows = await db
    .select()
    .from(faceitAnalysisCandidate)
    .where(eq(faceitAnalysisCandidate.analysisId, id))
    .orderBy(desc(faceitAnalysisCandidate.sharedPlayerCount), desc(faceitAnalysisCandidate.playedAt));
  const processedByFaceitId = await findProcessedMatches(candidateRows.map((candidate) => candidate.faceitMatchId));

  return {
    analysisId: analysis.id,
    faceitMatchId: analysis.faceitMatchId,
    requestingPlayerFaceitId: analysis.requestingPlayerFaceitId,
    selectedMap: analysis.selectedMap,
    opponentFaction: analysis.opponentFaction,
    createdAt: analysis.createdAt,
    opponents: opponents.map((opponent) => ({
      faceitPlayerId: opponent.faceitPlayerId,
      nickname: opponent.nickname,
    })),
    candidates: candidateRows.map((candidate) => {
      const processedMatchId = candidate.processedMatchId ?? processedByFaceitId.get(candidate.faceitMatchId) ?? null;
      return {
        faceitMatchId: candidate.faceitMatchId,
        map: candidate.mapName,
        sharedPlayerCount: candidate.sharedPlayerCount,
        sharedPlayers: parseSharedPlayers(candidate.sharedPlayersJson),
        playedAt: candidate.playedAt,
        faceitMatchroomUrl: candidate.faceitMatchroomUrl,
        processed: processedMatchId !== null,
        processedMatchId,
      };
    }),
  };
}

async function findProcessedMatches(faceitMatchIds: string[]) {
  const uniqueIds = [...new Set(faceitMatchIds)].filter(Boolean);
  if (uniqueIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: csMatch.id, faceitMatchId: csMatch.faceitMatchId })
    .from(csMatch)
    .where(inArray(csMatch.faceitMatchId, uniqueIds));
  return new Map(rows.flatMap((row) => row.faceitMatchId ? [[row.faceitMatchId, row.id] as const] : []));
}

function toStoredAnalysis(
  analysis: typeof faceitAnalysis.$inferSelect,
  opponents: FaceitPlayer[],
  candidates: DiscoveryCandidate[],
  processedByFaceitId: Map<string, string>,
  warnings: string[],
): StoredAnalysis {
  return {
    analysisId: analysis.id,
    faceitMatchId: analysis.faceitMatchId,
    requestingPlayerFaceitId: analysis.requestingPlayerFaceitId,
    selectedMap: analysis.selectedMap,
    opponentFaction: analysis.opponentFaction,
    createdAt: analysis.createdAt,
    opponents,
    candidates: candidates.map((candidate) => {
      const processedMatchId = processedByFaceitId.get(candidate.faceitMatchId) ?? null;
      return {
        ...candidate,
        processed: processedMatchId !== null,
        processedMatchId,
      };
    }),
    warnings,
  };
}

function parseSharedPlayers(value: unknown): FaceitPlayer[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const faceitPlayerId = typeof record.faceitPlayerId === "string" ? record.faceitPlayerId : null;
      const nickname = typeof record.nickname === "string" ? record.nickname : faceitPlayerId;
      return faceitPlayerId && nickname ? [{ faceitPlayerId, nickname }] : [];
    })
    : [];
}
