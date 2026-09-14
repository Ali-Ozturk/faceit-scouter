import type { AnalysisCandidate, AnalysisResponse, BackendAnalysisInput, CurrentFaceitMatch, DownloadStatus, ExtensionSettings } from "./types.js";

export type ExtensionMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "GET_CURRENT_FACEIT_MATCH" }
  | { type: "CURRENT_FACEIT_MATCH"; payload: CurrentFaceitMatch }
  | { type: "CREATE_ANALYSIS"; input: BackendAnalysisInput }
  | { type: "ANALYSIS_CREATED"; payload: AnalysisResponse }
  | { type: "START_DOWNLOADS"; candidates: AnalysisCandidate[]; includeProcessed: boolean; requesterNickname?: string; analysisId?: string }
  | { type: "DOWNLOAD_PROGRESS"; payload: DownloadStatus[] }
  | { type: "GET_FACEIT_DEMO_URL"; matchId: string }
  | { type: "TRIGGER_FACEIT_DEMO"; matchId: string }
  | { type: "FACEIT_DEMO_RESULT"; matchId: string; demoUrl?: string; error?: string }
  | { type: "OPEN_MATCHROOM"; url: string }
  | { type: "ERROR"; message: string };

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && [
    "GET_SETTINGS",
    "SAVE_SETTINGS",
    "GET_CURRENT_FACEIT_MATCH",
    "CURRENT_FACEIT_MATCH",
    "CREATE_ANALYSIS",
    "ANALYSIS_CREATED",
    "START_DOWNLOADS",
    "DOWNLOAD_PROGRESS",
    "GET_FACEIT_DEMO_URL",
    "TRIGGER_FACEIT_DEMO",
    "FACEIT_DEMO_RESULT",
    "OPEN_MATCHROOM",
    "ERROR",
  ].includes(record.type);
}
