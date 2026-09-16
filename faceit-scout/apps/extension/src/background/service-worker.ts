import { guardedAnalysis } from "../api/analysis-gate.js";
import { demoJobs, normalizeBackendUrl } from "../api/backend.js";
import { createFaceitMatchroomUrl, extractFaceitMatchId } from "../faceit/match-url.js";
import { isExtensionMessage } from "../shared/messages.js";
import type { AnalysisCandidate, CurrentFaceitMatch, DownloadStatus } from "../shared/types.js";
import { DOWNLOAD_STATUS_KEY, getPopupState, savePopupState } from "../storage/popup-state.js";
import { getSettings, saveSettings } from "../storage/settings.js";

let startingDownloads = false;

chrome.alarms.create("refresh-imports", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { refreshServerJobs().catch(() => undefined); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;

  if (message.type === "GET_SETTINGS") {
    refreshServerJobs().catch(() => undefined);
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then(sendResponse).catch(error => sendResponse({ error: errorMessage(error) }));
    return true;
  }

  if (message.type === "GET_CURRENT_FACEIT_MATCH") {
    getCurrentFaceitMatch().then(sendResponse).catch(error => sendResponse({ error: errorMessage(error) }));
    return true;
  }

  if (message.type === "CREATE_ANALYSIS") {
    getSettings()
      .then(async settings => {
        const result = await guardedAnalysis(settings.backendUrl, message.input);
        const contextKey = JSON.stringify([settings.backendUrl, settings.faceitPlayerId]);
        const saved = await getPopupState({ contextKey, matchId: message.input.faceitMatchId });
        if (saved.analysis?.analysisId !== result.analysisId) {
          await savePopupState({ contextKey, matchId: message.input.faceitMatchId,
            selectedMap: message.input.selectedMap ?? "", analysis: result,
            analysisMinimumSharedPlayers: message.input.minimumSharedPlayers ?? 4,
            selectedCandidateIds: [...result.candidates].sort((a, b) => (Date.parse(b.playedAt ?? "") || 0) - (Date.parse(a.playedAt ?? "") || 0)).filter(c => !c.processed).slice(0, 3).map(c => c.faceitMatchId),
            message: result.candidates.length ? `Found ${result.candidates.length} historical matches.` : "Analysis complete. No matching history found.",
            messageKind: "success",
          });
        }
        return result;
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }

  if (message.type === "OPEN_SELECTED_MATCHES") {
    if (startingDownloads) { sendResponse({ error: "A submission is already in progress." }); return false; }
    startingDownloads = true;
    startDownloads(message.candidates, message.includeProcessed, message.requesterNickname, message.analysisId)
      .then(sendResponse)
      .catch(error => sendResponse({ error: errorMessage(error) }))
      .finally(() => { startingDownloads = false; });
    return true;
  }

  if (message.type === "OPEN_MATCHROOM") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

async function getCurrentFaceitMatch(): Promise<CurrentFaceitMatch> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const fromUrl = extractFaceitMatchId(url);
  return { matchId: fromUrl, selectedMap: null, url };
}

async function startDownloads(candidates: AnalysisCandidate[], includeProcessed: boolean, requesterNickname?: string, analysisId?: string) {
  const settings = await getSettings();
  const pending = [...new Map(candidates.map(c => [c.faceitMatchId, c])).values()].filter(c => includeProcessed || !c.processed);
  if (!pending.length || pending.length > 3) throw new Error("Choose between one and three matches.");
  const jobs = await demoJobs(settings.backendUrl, settings.importKey, pending.map(c => ({
    faceitMatchId: c.faceitMatchId, requesterNickname: requesterNickname || settings.faceitPlayerId,
    analysisId, matchPlayedAt: c.playedAt, mapName: c.map,
  })));
  // The upload page never receives the import key in a URL or browser history.
  await chrome.tabs.create({ url: normalizeBackendUrl(settings.backendUrl) + "/imports?uploads=" + jobs.map(j => j.id).join(","), active: false });
  for (const candidate of pending) await chrome.tabs.create({ url: createFaceitMatchroomUrl(candidate.faceitMatchId), active: false });
  await refreshServerJobs(true);
  return { statuses: await getDownloadStatuses() };
}

async function getDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await chrome.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}

async function refreshServerJobs(force = false) {
  const settings = await getSettings();
  if (!settings.importKey) return;
  const jobs = await demoJobs(settings.backendUrl, settings.importKey);
  const seen = new Set<string>();
  const statuses: DownloadStatus[] = [];
  for (const job of jobs) {
    if (seen.has(job.faceitMatchId)) continue;
    seen.add(job.faceitMatchId);
    statuses.push({ faceitMatchId: job.faceitMatchId,
      state: ["AWAITING_UPLOAD", "UPLOADING"].includes(job.status) ? "waiting_for_user" : job.status === "COMPLETED" ? "completed" : job.status === "FAILED" ? "failed" : job.status === "PROCESSING" ? "processing" : job.status === "DOWNLOADING" ? "downloading" : "queued",
      message: job.error || (["AWAITING_UPLOAD", "UPLOADING"].includes(job.status) ? "Download with FACEIT’s Watch Demo button, then upload on Scout’s Imports page." : job.importStatus || job.status),
    });
  }
  if (force || !startingDownloads) await setDownloadStatuses(statuses);
}

async function setDownloadStatuses(statuses: DownloadStatus[]) {
  await chrome.storage.local.set({ [DOWNLOAD_STATUS_KEY]: statuses });
  chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", payload: statuses }).catch(() => undefined);
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Unknown extension error"; }
