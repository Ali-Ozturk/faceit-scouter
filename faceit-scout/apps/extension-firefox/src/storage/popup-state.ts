import { extensionApi } from "../shared/extension-api.js";
import type { PopupState, DownloadStatus } from "../shared/types.js";

const POPUP_STATE_KEY = "faceitScoutPopupState";
export const DOWNLOAD_STATUS_KEY = "faceitScoutDownloadStatus";

export const defaultPopupState: PopupState = {
  matchId: "",
  selectedMap: "",
  analysis: null,
  analysisMinimumSharedPlayers: 4,
  selectedCandidateIds: [],
  message: "",
};

export async function getPopupState(scope?: { contextKey: string; matchId: string }): Promise<PopupState> {
  const key = scope ? scopedKey(scope.contextKey, scope.matchId) : POPUP_STATE_KEY;
  const stored = await extensionApi.storage.local.get(key);
  return { ...defaultPopupState, ...(stored[key] ?? {}) };
}

export async function savePopupState(state: Partial<PopupState>) {
  const current = await getPopupState(state.contextKey && state.matchId ? { contextKey: state.contextKey, matchId: state.matchId } : undefined);
  const next = { ...current, ...state };
  await extensionApi.storage.local.set({ [POPUP_STATE_KEY]: next,
    ...(next.contextKey && next.matchId ? { [scopedKey(next.contextKey, next.matchId)]: next } : {}),
  });
  return next;
}

function scopedKey(contextKey: string, matchId: string) { return `${POPUP_STATE_KEY}:${contextKey}:${matchId}`; }

export async function getStoredDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await extensionApi.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}
