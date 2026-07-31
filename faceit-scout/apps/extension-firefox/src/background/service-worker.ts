import { createAnalysis } from "../api/backend.js";
import { createDemoFilename } from "../downloads/filename.js";
import { runBoundedQueue } from "../downloads/queue.js";
import { createFaceitMatchroomUrl, extractFaceitMatchId } from "../faceit/match-url.js";
import { extensionApi } from "../shared/extension-api.js";
import { isExtensionMessage } from "../shared/messages.js";
import type { AnalysisCandidate, CurrentFaceitMatch, DownloadStatus } from "../shared/types.js";
import { DOWNLOAD_STATUS_KEY } from "../storage/popup-state.js";
import { getSettings, saveSettings } from "../storage/settings.js";

const capturedDemoUrls = new Map<string, string>();
const pendingDemoCaptures = new Map<number, string>();

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;

  if (message.type === "GET_SETTINGS") {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    saveSettings(message.settings).then(sendResponse);
    return true;
  }

  if (message.type === "GET_CURRENT_FACEIT_MATCH") {
    getCurrentFaceitMatch().then(sendResponse);
    return true;
  }

  if (message.type === "CREATE_ANALYSIS") {
    getSettings()
      .then((settings) => createAnalysis(settings.backendUrl, message.input))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: errorMessage(error) }));
    return true;
  }

  if (message.type === "START_DOWNLOADS") {
    startDownloads(message.candidates, message.includeProcessed).then(sendResponse);
    return true;
  }

  if (message.type === "OPEN_MATCHROOM") {
    extensionApi.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

extensionApi.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;
  const statuses = await getDownloadStatuses();
  const status = statuses.find((item) => item.chromeDownloadId === delta.id);
  if (!status) return;
  if (delta.state.current === "complete") status.state = "completed";
  if (delta.state.current === "interrupted") {
    status.state = "failed";
    status.message = "Chrome interrupted the download.";
  }
  await setDownloadStatuses(statuses);
});

extensionApi.webRequest?.onCompleted?.addListener?.(
  (details) => {
    if (!isLikelyDemoUrl(details.url)) return;
    if (details.tabId >= 0) {
      const pendingMatchId = pendingDemoCaptures.get(details.tabId);
      if (pendingMatchId) capturedDemoUrls.set(pendingMatchId, details.url);
    }
    const matchId = extractMatchIdFromDemoUrl(details.url);
    if (matchId) capturedDemoUrls.set(matchId, details.url);
  },
  { urls: ["https://*.faceit.com/*", "https://*.amazonaws.com/*", "https://*.cloudfront.net/*"] },
);

async function getCurrentFaceitMatch(): Promise<CurrentFaceitMatch> {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const fromUrl = extractFaceitMatchId(url);
  if (!tab?.id) return { matchId: fromUrl, selectedMap: null, url };

  try {
    const fromContentScript = await extensionApi.tabs.sendMessage(tab.id, { type: "GET_CURRENT_FACEIT_MATCH" });
    return { matchId: fromContentScript.matchId ?? fromUrl, selectedMap: fromContentScript.selectedMap ?? null, url };
  } catch {
    return { matchId: fromUrl, selectedMap: null, url };
  }
}

async function startDownloads(candidates: AnalysisCandidate[], includeProcessed: boolean) {
  const settings = await getSettings();
  const unique = new Map(candidates.map((candidate) => [candidate.faceitMatchId, candidate]));
  const pending = [...unique.values()].filter((candidate) => includeProcessed || !candidate.processed);
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
        message: "Automatic demo URL capture failed. Use the opened matchroom fallback.",
      });
      return;
    }

    await updateStatus(candidate.faceitMatchId, { state: "downloading", message: "Downloading demo." });
    const chromeDownloadId = await extensionApi.downloads.download({
      url: demoUrl,
      filename: createDemoFilename(candidate.faceitMatchId, settings.preferredDownloadSubdirectory),
      saveAs: false,
      conflictAction: "uniquify",
    });
    await updateStatus(candidate.faceitMatchId, { state: "downloading", chromeDownloadId });
  }, async ({ item, error }) => {
    if (error) {
      await updateStatus(item.faceitMatchId, { state: "failed", message: error.message });
    }
  });

  return { statuses: await getDownloadStatuses() };
}

async function retrieveDemoUrl(candidate: AnalysisCandidate) {
  const captured = capturedDemoUrls.get(candidate.faceitMatchId);
  if (captured) return captured;

  const directUrl = await retrieveDemoUrlFromExistingFaceitTab(candidate.faceitMatchId);
  if (directUrl) return directUrl;

  const tab = await extensionApi.tabs.create({ url: candidate.faceitMatchroomUrl || createFaceitMatchroomUrl(candidate.faceitMatchId), active: false });
  if (!tab.id) return null;
  pendingDemoCaptures.set(tab.id, candidate.faceitMatchId);
  await waitForTabComplete(tab.id);

  try {
    const response = await extensionApi.tabs.sendMessage(tab.id, { type: "TRIGGER_FACEIT_DEMO", matchId: candidate.faceitMatchId });
    if (response?.demoUrl) {
      await closeTab(tab.id);
      return response.demoUrl as string;
    }
    const capturedAfterClick = await waitForCapturedDemoUrl(candidate.faceitMatchId, 12_000);
    if (capturedAfterClick) {
      await closeTab(tab.id);
      return capturedAfterClick;
    }
    await updateStatus(candidate.faceitMatchId, { state: "waiting_for_user", message: response?.error ?? "Manual download required." });
    await extensionApi.tabs.update(tab.id, { active: true });
    return null;
  } catch {
    const capturedAfterError = await waitForCapturedDemoUrl(candidate.faceitMatchId, 12_000);
    if (capturedAfterError) {
      await closeTab(tab.id);
      return capturedAfterError;
    }
    await extensionApi.tabs.update(tab.id, { active: true });
    return null;
  } finally {
    pendingDemoCaptures.delete(tab.id);
  }
}

async function closeTab(tabId: number) {
  try {
    await extensionApi.tabs.remove(tabId);
  } catch {
    // The tab may already have been closed by the user or browser.
  }
}

async function retrieveDemoUrlFromExistingFaceitTab(matchId: string) {
  const tabs = await extensionApi.tabs.query({ url: ["https://www.faceit.com/*", "https://faceit.com/*", "https://*.faceit.com/*"] });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await extensionApi.tabs.sendMessage(tab.id, { type: "GET_FACEIT_DEMO_URL", matchId });
      if (response?.demoUrl && typeof response.demoUrl === "string") return response.demoUrl;
    } catch {
      // Try the next FACEIT tab. Some tabs may not have the content script ready.
    }
  }
  return null;
}

async function getDownloadStatuses(): Promise<DownloadStatus[]> {
  const stored = await extensionApi.storage.local.get(DOWNLOAD_STATUS_KEY);
  return Array.isArray(stored[DOWNLOAD_STATUS_KEY]) ? stored[DOWNLOAD_STATUS_KEY] : [];
}

async function setDownloadStatuses(statuses: DownloadStatus[]) {
  await extensionApi.storage.local.set({ [DOWNLOAD_STATUS_KEY]: statuses });
  extensionApi.runtime.sendMessage({ type: "DOWNLOAD_PROGRESS", payload: statuses }).catch(() => undefined);
}

async function updateStatus(matchId: string, patch: Partial<DownloadStatus>) {
  const statuses = await getDownloadStatuses();
  const index = statuses.findIndex((status) => status.faceitMatchId === matchId);
  if (index === -1) statuses.push({ faceitMatchId: matchId, state: "queued", ...patch });
  else statuses[index] = { ...statuses[index], ...patch };
  await setDownloadStatuses(statuses);
}

function waitForTabComplete(tabId: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      extensionApi.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10_000);
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      extensionApi.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    extensionApi.tabs.onUpdated.addListener(listener);
  });
}

async function waitForCapturedDemoUrl(matchId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const captured = capturedDemoUrls.get(matchId);
    if (captured) return captured;
    await wait(500);
  }
  return null;
}

function isLikelyDemoUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes(".dem") || lower.includes(".dem.zst") || (lower.includes("demo") && (lower.includes("s3") || lower.includes("cloudfront")));
}

function extractMatchIdFromDemoUrl(url: string) {
  const decoded = decodeURIComponent(url);
  return decoded.match(/(?:^|[/_-])([0-9a-f]{8}-[0-9a-f-]{27,}|1-[a-z0-9-]{8,})(?:[/_.-]|$)/i)?.[1] ?? null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown extension error";
}
