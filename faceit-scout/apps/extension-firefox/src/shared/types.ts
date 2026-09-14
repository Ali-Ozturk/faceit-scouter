export type ExtensionSettings = {
  backendUrl: string;
  importKey: string;
  faceitPlayerId: string;
  maxConcurrentDownloads: number;
};

export type AnalysisCandidate = {
  faceitMatchId: string;
  map: string | null;
  sharedPlayerCount: number;
  playedAt: string | null;
  faceitMatchroomUrl: string;
  processed: boolean;
  processedMatchId: string | null;
};

export type AnalysisResponse = {
  requesterNickname?: string;
  analysisId: string;
  minimumSharedPlayers?: number;
  opponents: Array<{ faceitPlayerId: string; nickname: string }>;
  candidates: AnalysisCandidate[];
  warnings?: string[];
};

export type DownloadState = "queued" | "opening" | "waiting_for_user" | "downloading" | "processing" | "completed" | "unavailable" | "failed";

export type DownloadStatus = {
  faceitMatchId: string;
  state: DownloadState;
  message?: string;
  chromeDownloadId?: number;
};

export type CurrentFaceitMatch = {
  matchId: string | null;
  selectedMap: string | null;
  url: string;
};

export type BackendAnalysisInput = {
  faceitMatchId: string;
  requestingPlayerFaceitId: string;
  selectedMap?: string;
  minimumSharedPlayers?: number;
};

export type PopupState = {
  contextKey?: string;
  messageKind?: string;
  cooldowns?: Record<number, number>;
  matchId: string;
  selectedMap: string;
  analysis: AnalysisResponse | null;
  analysisMinimumSharedPlayers: number;
  selectedCandidateIds: string[];
  message: string;
};
