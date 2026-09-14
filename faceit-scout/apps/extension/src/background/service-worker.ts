import { guardedAnalysis } from "../api/analysis-gate.js";
import { demoJobs } from "../api/backend.js";
import { runBoundedQueue } from "../downloads/queue.js";
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

  if (message.type === "START_DOWNLOADS") {
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
  if (!tab?.id) return { matchId: fromUrl, selectedMap: null, url };

  try {
    const fromContentScript = await chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_FACEIT_MATCH" });
    return { matchId: fromContentScript.matchId ?? fromUrl, selectedMap: fromContentScript.selectedMap ?? null, url };
  } catch {
    return { matchId: fromUrl, selectedMap: null, url };
  }
}

async function startDownloads(candidates: AnalysisCandidate[], includeProcessed: boolean, requesterNickname?: string, analysisId?: string) {
  const settings = await getSettings();
  const unique = new Map(candidates.map((candidate) => [candidate.faceitMatchId, candidate]));
  const pending = [...unique.values()].filter((candidate) => includeProcessed || !candidate.processed);
  if (pending.length > 3 || !pending.length) throw new Error("Choose between one and three demos.");
  {
    const jobs = await demoJobs(settings.backendUrl, settings.importKey);
    const active = jobs.filter(j => ["QUEUED", "DOWNLOADING", "PROCESSING"].includes(j.status));
    if (active.length + pending.filter(c => !active.some(j => j.faceitMatchId === c.faceitMatchId)).length > 9) {
      throw new Error("The server queue is full (9 demos queued or processing). Wait for a demo to finish.");
    }
  }
  const statuses = pending.map((candidate): DownloadStatus => ({
    faceitMatchId: candidate.faceitMatchId,
    state: "queued",
  }));
  await setDownloadStatuses(statuses);

  await runBoundedQueue(pending, settings.maxConcurrentDownloads, async (candidate) => {
    await updateStatus(candidate.faceitMatchId, { state: "opening", message: "Finding FACEIT demo URL." });
    const demoUrl = await retrieveDemoUrl(candidate);
    if (!demoUrl) {
      await updateStatus(candidate.faceitMatchId, {
        state: "waiting_for_user",
        message: "FACEIT did not provide a demo URL. Check that you are signed in and the demo is available, then retry.",
      });
      return;
    }

    await demoJobs(settings.backendUrl, settings.importKey, [{
      faceitMatchId: candidate.faceitMatchId, url: demoUrl,
      requesterNickname: requesterNickname || settings.faceitPlayerId,
      ...(analysisId ? { analysisId } : {}),
      matchPlayedAt: candidate.playedAt, mapName: candidate.map,
    }]);
    await updateStatus(candidate.faceitMatchId, { state: "queued", message: "Accepted by server. Track progress in Imports." });
  }, async ({ item, error }) => {
    if (error) {
      await updateStatus(item.faceitMatchId, { state: "failed", message: error.message });
    }
  });

  return { statuses: await getDownloadStatuses() };
}

async function retrieveDemoUrl(candidate: AnalysisCandidate) {
  // Request a fresh URL using FACEIT cookies in the tab. Never start a browser download.
  const directUrl = await retrieveDemoUrlFromExistingFaceitTab(candidate.faceitMatchId);
  if (directUrl) return directUrl;
  const tab = await chrome.tabs.create({ url: createFaceitMatchroomUrl(candidate.faceitMatchId), active: false });
  if (!tab.id) return null;
  try {
    await waitForTabComplete(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_FACEIT_DEMO_URL", matchId: candidate.faceitMatchId });
    if (response?.error) throw new Error(response.error);
    return typeof response?.demoUrl === "string" ? response.demoUrl : null;
  } finally { await closeTab(tab.id); }
}

async function closeTab(tabId: number) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The tab may already have been closed by the user or browser.
  }
}

async function retrieveDemoUrlFromExistingFaceitTab(matchId: string) {
  const tabs = await chrome.tabs.query({ url: ["https://www.faceit.com/*", "https://faceit.com/*", "https://*.faceit.com/*"] });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_FACEIT_DEMO_URL", matchId });
      if (response?.demoUrl && typeof response.demoUrl === "string") return response.demoUrl;
    } catch {
      // Try the next FACEIT tab. Some tabs may not have the content script ready.
    }
  }
  return null;
}

async function getDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await chrome.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}

async function refreshServerJobs() {
  const settings = await getSettings();
  if (!settings.importKey) return;
  const jobs = await demoJobs(settings.backendUrl, settings.importKey);
  const seen = new Set<string>();
  const statuses: DownloadStatus[] = [];
  for (const job of jobs) {
    if (seen.has(job.faceitMatchId)) continue;
    seen.add(job.faceitMatchId);
    statuses.push({ faceitMatchId: job.faceitMatchId,
      state: job.status === "COMPLETED" ? "completed" : job.status === "FAILED" ? "failed" : job.status === "PROCESSING" ? "processing" : job.status === "DOWNLOADING" ? "downloading" : "queued",
      message: job.error || job.importStatus || job.status,
    });
  }
  if (!startingDownloads) await setDownloadStatuses(statuses);
}

async function setDownloadStatuses(statuses: DownloadStatus[]) {
  await chrome.storage.local.set({ [DOWNLOAD_STATUS_KEY]: statuses });
  chrome.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", payload: statuses }).catch(() => undefined);
}

let statusWrites = Promise.resolve();
function updateStatus(matchId: string, patch: Partial<DownloadStatus>) {
  statusWrites = statusWrites.catch(() => undefined).then(() => applyStatus(matchId, patch));
  return statusWrites;
}
async function applyStatus(matchId: string, patch: Partial<DownloadStatus>) {
  const statuses = await getDownloadStatuses();
  const index = statuses.findIndex((status) => status.faceitMatchId === matchId);
  if (index === -1) statuses.push({ faceitMatchId: matchId, state: "queued", ...patch });
  else statuses[index] = { ...statuses[index], ...patch };
  await setDownloadStatuses(statuses);
}

function waitForTabComplete(tabId: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10_000);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown extension error";
}
