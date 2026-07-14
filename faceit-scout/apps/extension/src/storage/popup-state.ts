import type { PopupState, DownloadStatus } from "../shared/types.js";

const POPUP_STATE_KEY = "faceitScoutPopupState";
export const DOWNLOAD_STATUS_KEY = "faceitScoutDownloadStatus";

export const defaultPopupState: PopupState = {
  matchId: "",
  selectedMap: "",
  analysis: null,
  selectedCandidateIds: [],
  message: "",
};

export async function getPopupState(): Promise<PopupState> {
  const stored = await chrome.storage.local.get(POPUP_STATE_KEY);
  return { ...defaultPopupState, ...(stored[POPUP_STATE_KEY] ?? {}) };
}

export async function savePopupState(state: Partial<PopupState>) {
  const current = await getPopupState();
  const next = { ...current, ...state };
  await chrome.storage.local.set({ [POPUP_STATE_KEY]: next });
  return next;
}

export async function getStoredDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await chrome.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}
