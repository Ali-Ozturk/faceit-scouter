import type { AnalysisCandidate, AnalysisResponse, BackendAnalysisInput, CurrentFaceitMatch, DownloadStatus, ExtensionSettings } from "./types.js";

export type ExtensionMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: Partial<ExtensionSettings> }
  | { type: "GET_CURRENT_FACEIT_MATCH" }
  | { type: "CURRENT_FACEIT_MATCH"; payload: CurrentFaceitMatch }
  | { type: "CREATE_ANALYSIS"; input: BackendAnalysisInput }
  | { type: "ANALYSIS_CREATED"; payload: AnalysisResponse }
  | { type: "OPEN_SELECTED_MATCHES"; candidates: AnalysisCandidate[]; includeProcessed: boolean; requesterNickname?: string; analysisId?: string }
  | { type: "DOWNLOAD_PROGRESS"; payload: DownloadStatus[] }
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
    "OPEN_SELECTED_MATCHES",
    "DOWNLOAD_PROGRESS",
    "OPEN_MATCHROOM",
    "ERROR",
  ].includes(record.type);
}
