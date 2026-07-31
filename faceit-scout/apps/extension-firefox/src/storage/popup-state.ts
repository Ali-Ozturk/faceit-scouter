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

export async function getPopupState(): Promise<PopupState> {
  const stored = await extensionApi.storage.local.get(POPUP_STATE_KEY);
  return { ...defaultPopupState, ...(stored[POPUP_STATE_KEY] ?? {}) };
}

export async function savePopupState(state: Partial<PopupState>) {
  const current = await getPopupState();
  const next = { ...current, ...state };
  await extensionApi.storage.local.set({ [POPUP_STATE_KEY]: next });
  return next;
}

export async function getStoredDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await extensionApi.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}
