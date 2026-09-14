import type { AnalysisResponse, BackendAnalysisInput } from "../shared/types.js";

export function normalizeBackendUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  const url = new URL(trimmed || "http://localhost:3101");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new Error("Use an HTTPS server origin, or http://localhost:3101 for local use.");
  }
  return url.origin;
}

export type ServerJob = { id: string; faceitMatchId: string; status: string; importStatus?: string; error?: string };

export async function demoJobs(backendUrl: string, key: string, demos?: Array<{ faceitMatchId: string; url: string; requesterNickname?: string; analysisId?: string; matchPlayedAt?: string | null; mapName?: string | null }>): Promise<ServerJob[]> {
  if (key.trim().length < 24) throw new Error("Set the import access key from your backend .env (at least 24 characters).");
  const response = await fetch(`${normalizeBackendUrl(backendUrl)}/api/demo-downloads`, {
    method: demos ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
    ...(demos ? { body: JSON.stringify({ demos }) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => {
    throw new Error(`The backend returned a page instead of the v2 import API (HTTP ${response.status}). Check the Backend URL and run docker compose up -d --build in the project folder.`);
  });
  if (!response.ok) throw new Error(body.error || `Import request failed (${response.status}).`);
  if (!body || !Array.isArray(body.jobs)) throw new Error("Unexpected import API response. Update the backend to v2.");
  return body.jobs;
}

export function createAnalysisRequest(input: BackendAnalysisInput) {
  return {
    faceitMatchId: input.faceitMatchId.trim(),
    requestingPlayerFaceitId: input.requestingPlayerFaceitId.trim(),
    ...(input.selectedMap?.trim() ? { selectedMap: input.selectedMap.trim() } : {}),
    ...(input.minimumSharedPlayers ? { minimumSharedPlayers: input.minimumSharedPlayers } : {}),
  };
}

export async function createAnalysis(backendUrl: string, input: BackendAnalysisInput): Promise<AnalysisResponse> {
  const response = await fetch(`${normalizeBackendUrl(backendUrl)}/api/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createAnalysisRequest(input)),
    signal: AbortSignal.timeout(120000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Backend request failed with ${response.status}`);
  }
  return mapAnalysisResponse(body);
}

export function mapAnalysisResponse(value: unknown): AnalysisResponse {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const opponents = Array.isArray(record.opponents) ? record.opponents : [];
  return {
    analysisId: stringValue(record.analysisId) ?? "",
    requesterNickname: stringValue(record.requesterNickname) ?? undefined,
    minimumSharedPlayers: numberValue(record.minimumSharedPlayers) ?? undefined,
    opponents: opponents.flatMap((item) => {
      const opponent = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const faceitPlayerId = stringValue(opponent.faceitPlayerId);
      const nickname = stringValue(opponent.nickname) ?? faceitPlayerId;
      return faceitPlayerId && nickname ? [{ faceitPlayerId, nickname }] : [];
    }),
    candidates: candidates.flatMap((item) => {
      const candidate = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const faceitMatchId = stringValue(candidate.faceitMatchId);
      const faceitMatchroomUrl = stringValue(candidate.faceitMatchroomUrl);
      if (!faceitMatchId || !faceitMatchroomUrl) return [];
      return [{
        faceitMatchId,
        map: stringValue(candidate.map),
        sharedPlayerCount: numberValue(candidate.sharedPlayerCount) ?? 0,
        playedAt: stringValue(candidate.playedAt),
        faceitMatchroomUrl,
        processed: Boolean(candidate.processed),
        processedMatchId: stringValue(candidate.processedMatchId),
      }];
    }),
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : [],
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
