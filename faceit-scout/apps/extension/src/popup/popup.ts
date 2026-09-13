import { createAnalysisRequest, normalizeBackendUrl } from "../api/backend.js";
import { candidatesForDownload, unprocessedCandidateIds } from "../downloads/selection.js";
import type { AnalysisCandidate, AnalysisResponse, DownloadStatus, ExtensionSettings } from "../shared/types.js";
import { getPopupState, getStoredDownloadStatuses, savePopupState } from "../storage/popup-state.js";

const backendUrlInput = input("backend-url");
const importKeyInput = input("import-key");
const downloadModeInput = element("download-mode") as HTMLSelectElement;
const playerIdInput = input("player-id");
const downloadSubdirectoryInput = input("download-subdirectory");
const matchIdInput = input("match-id");
const selectedMapInput = input("selected-map");
const message = element("message");
const fallbackAnalysis = element("fallback-analysis") as HTMLElement;
const results = element("results") as HTMLElement;
const opponents = element("opponents");
const candidateList = element("candidate-list");
const startAnalysisButton = element("start-analysis") as HTMLButtonElement;
const fallbackAnalysisButton = element("fallback-analysis-button") as HTMLButtonElement;
const detectMatchButton = element("detect-match") as HTMLButtonElement;
const downloadAllButton = element("download-all") as HTMLButtonElement;
const downloadSelectedButton = element("download-selected") as HTMLButtonElement;
const selectAllButton = element("select-all") as HTMLButtonElement;
const unselectAllButton = element("unselect-all") as HTMLButtonElement;

let currentAnalysis: AnalysisResponse | null = null;
let currentAnalysisMinimumSharedPlayers = 4;
let selectedIds = new Set<string>();
let statuses: DownloadStatus[] = [];

init().catch((error) => showMessage(error instanceof Error ? error.message : "Could not initialize extension."));

async function init() {
  const settings = await sendMessage<ExtensionSettings>({ type: "GET_SETTINGS" });
  const popupState = await getPopupState();
  backendUrlInput.value = settings.backendUrl;
  importKeyInput.value = settings.importKey;
  downloadModeInput.value = settings.downloadMode;
  playerIdInput.value = settings.faceitPlayerId;
  downloadSubdirectoryInput.value = settings.preferredDownloadSubdirectory;
  matchIdInput.value = popupState.matchId;
  selectedMapInput.value = popupState.selectedMap;
  currentAnalysis = popupState.analysis ? sortAnalysisCandidates(popupState.analysis) : null;
  currentAnalysisMinimumSharedPlayers = popupState.analysisMinimumSharedPlayers;
  selectedIds = new Set(popupState.selectedCandidateIds.slice(0, 3));
  statuses = await getStoredDownloadStatuses();

  if (currentAnalysis) {
    renderAnalysis();
    showMessage(popupState.message || `Restored ${currentAnalysis.candidates.length} candidate matches.`);
  } else if (matchIdInput.value) {
    showMessage(popupState.message || "Restored previous match ID.");
  } else {
    await detectCurrentMatch();
  }

  element("save-connection").addEventListener("click", () => {
    try {
      const origin = normalizeBackendUrl(backendUrlInput.value);
      // Request on a direct user gesture; only this server's origin is granted.
      chrome.permissions.request({ origins: [`${origin}/*`] }).then(async granted => {
        if (!granted) throw new Error("Host permission was declined.");
        await saveSettings();
        showMessage("Connection saved. Your FACEIT cookies remain in your browser.");
      }).catch(error => showMessage(error.message));
    } catch (error) { showMessage(error instanceof Error ? error.message : "Invalid server address."); }
  });
  playerIdInput.addEventListener("change", saveSettings);
  downloadSubdirectoryInput.addEventListener("change", saveSettings);
  matchIdInput.addEventListener("input", persistPopupState);
  selectedMapInput.addEventListener("input", persistPopupState);
  detectMatchButton.addEventListener("click", () => detectCurrentMatch());
  startAnalysisButton.addEventListener("click", () => startAnalysis(4));
  fallbackAnalysisButton.addEventListener("click", () => startAnalysis(3));
  downloadAllButton.addEventListener("click", () => startDownloads([...unprocessedCandidateIds(currentAnalysis?.candidates ?? [])].slice(0, 3)));
  downloadSelectedButton.addEventListener("click", () => startDownloads([...selectedIds]));
  selectAllButton.addEventListener("click", () => {
    selectedIds = new Set([...unprocessedCandidateIds(currentAnalysis?.candidates ?? [])].slice(0, 3));
    persistPopupState();
    renderCandidates();
  });
  unselectAllButton.addEventListener("click", () => {
    selectedIds = new Set();
    persistPopupState();
    renderCandidates();
  });

  chrome.runtime.onMessage.addListener((payload) => {
    if (payload?.type !== "DOWNLOAD_PROGRESS") return;
    statuses = payload.payload ?? [];
    renderCandidates();
  });
}

async function saveSettings() {
  await sendMessage<ExtensionSettings>({
    type: "SAVE_SETTINGS",
    settings: {
      backendUrl: backendUrlInput.value,
      importKey: importKeyInput.value.trim(),
      downloadMode: downloadModeInput.value,
      faceitPlayerId: playerIdInput.value,
      preferredDownloadSubdirectory: downloadSubdirectoryInput.value,
    },
  });
}

async function detectCurrentMatch() {
  const response = await sendMessage<{ matchId: string | null; selectedMap: string | null; url: string }>({ type: "GET_CURRENT_FACEIT_MATCH" });
  if (response.selectedMap) {
    selectedMapInput.value = response.selectedMap;
  }
  if (response.matchId) {
    matchIdInput.value = response.matchId;
    showMessage(response.selectedMap ? `Detected current FACEIT matchroom and ${response.selectedMap}.` : "Detected current FACEIT matchroom.");
    await persistPopupState();
  } else {
    showMessage(response.selectedMap ? `Detected ${response.selectedMap}. Enter the match ID manually.` : "No FACEIT matchroom detected. Enter the match ID manually.");
    await persistPopupState();
  }
}

async function startAnalysis(minimumSharedPlayers = 4) {
  await saveSettings();
  const inputPayload = createAnalysisRequest({
    faceitMatchId: matchIdInput.value,
    requestingPlayerFaceitId: playerIdInput.value,
    selectedMap: selectedMapInput.value,
    minimumSharedPlayers,
  });

  if (!inputPayload.faceitMatchId) {
    showMessage("Enter a FACEIT match ID.");
    return;
  }
  if (!inputPayload.requestingPlayerFaceitId) {
    showMessage("Enter your FACEIT player ID or nickname.");
    return;
  }

  startAnalysisButton.disabled = true;
  fallbackAnalysisButton.disabled = true;
  fallbackAnalysis.hidden = true;
  showMessage(minimumSharedPlayers === 3 ? "Running broader 3-player opponent analysis..." : "Running opponent analysis...");
  const response = await sendMessage<AnalysisResponse | { error: string }>({ type: "CREATE_ANALYSIS", input: inputPayload });
  startAnalysisButton.disabled = false;
  fallbackAnalysisButton.disabled = false;

  if ("error" in response) {
    showMessage(response.error);
    renderFallbackOffer();
    return;
  }

  currentAnalysis = sortAnalysisCandidates(response);
  currentAnalysisMinimumSharedPlayers = response.minimumSharedPlayers ?? minimumSharedPlayers;
  selectedIds = new Set([...unprocessedCandidateIds(currentAnalysis.candidates)].slice(0, 3));
  statuses = [];
  showMessage(analysisMessage(response, currentAnalysisMinimumSharedPlayers));
  await persistPopupState();
  renderAnalysis();
}

async function startDownloads(ids: string[]) {
  if (!currentAnalysis) return;
  await saveSettings();
  const idSet = new Set(ids);
  const candidates = candidatesForDownload(currentAnalysis.candidates, idSet, false);
  if (candidates.length === 0) {
    showMessage("No unprocessed selected matches to download.");
    return;
  }
  if (candidates.length > 3) { showMessage("Choose at most three demos."); return; }
  showMessage(`Starting ${candidates.length} download${candidates.length === 1 ? "" : "s"}...`);
  await persistPopupState();
  downloadSelectedButton.disabled = downloadAllButton.disabled = true;
  try {
    const response = await sendMessage<{ error?: string }>({ type: "START_DOWNLOADS", candidates, includeProcessed: false });
    if (response.error) showMessage(response.error);
  } catch (error) { showMessage(error instanceof Error ? error.message : "Submission interrupted. Check Imports before retrying."); }
  finally { downloadSelectedButton.disabled = downloadAllButton.disabled = false; }
}

function renderAnalysis() {
  results.hidden = false;
  renderFallbackOffer();
  opponents.innerHTML = "";
  for (const opponent of currentAnalysis?.opponents ?? []) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = opponent.nickname;
    opponents.append(chip);
  }
  renderCandidates();
}

function renderCandidates() {
  candidateList.innerHTML = "";
  for (const candidate of currentAnalysis?.candidates ?? []) {
    const status = statuses.find((item) => item.faceitMatchId === candidate.faceitMatchId);
    const row = document.createElement("article");
    row.className = "candidate";
    row.innerHTML = `
      <input type="checkbox" ${selectedIds.has(candidate.faceitMatchId) ? "checked" : ""} ${candidate.processed ? "" : ""} />
      <div>
        <div class="candidate-title">
          <span>${escapeHtml(candidate.map ?? "Unknown map")} · ${candidate.sharedPlayerCount} shared</span>
          <span class="${candidate.processed ? "processed" : ""}">${candidate.processed ? "Processed" : status?.state ?? "Ready"}</span>
        </div>
        <div class="candidate-meta">${escapeHtml(candidate.faceitMatchId)} · ${candidate.playedAt ? new Date(candidate.playedAt).toLocaleString() : "Unknown date"}</div>
        ${status?.message ? `<div class="candidate-meta">${escapeHtml(status.message)}</div>` : ""}
        <div class="candidate-actions">
          <a href="${candidate.faceitMatchroomUrl}" target="_blank" rel="noreferrer">Open matchroom</a>
          <button type="button" data-download="${candidate.faceitMatchId}">Download demo</button>
        </div>
      </div>
    `;
    const checkbox = row.querySelector<HTMLInputElement>("input[type='checkbox']");
    checkbox?.addEventListener("change", () => {
      if (checkbox.checked && selectedIds.size >= 3) { checkbox.checked = false; showMessage("Choose at most three demos."); return; }
      if (checkbox.checked) selectedIds.add(candidate.faceitMatchId);
      else selectedIds.delete(candidate.faceitMatchId);
      persistPopupState();
    });
    row.querySelector<HTMLButtonElement>("button[data-download]")?.addEventListener("click", () => startDownloads([candidate.faceitMatchId]));
    candidateList.append(row);
  }
}

function renderFallbackOffer() {
  fallbackAnalysis.hidden = !(
    currentAnalysis &&
    currentAnalysis.candidates.length === 0 &&
    currentAnalysisMinimumSharedPlayers >= 4
  );
}

function analysisMessage(response: AnalysisResponse, minimumSharedPlayers: number) {
  if (response.candidates.length) {
    return `Found ${response.candidates.length} candidate matches with ${minimumSharedPlayers}+ shared opponents.`;
  }
  return minimumSharedPlayers >= 4
    ? "No 4-player historical matches found."
    : "No 3-player historical matches found.";
}

function sortAnalysisCandidates(response: AnalysisResponse): AnalysisResponse {
  return {
    ...response,
    candidates: [...response.candidates].sort(compareCandidatesByNewest),
  };
}

function compareCandidatesByNewest(left: AnalysisCandidate, right: AnalysisCandidate) {
  return candidateTime(right) - candidateTime(left) || left.faceitMatchId.localeCompare(right.faceitMatchId);
}

function candidateTime(candidate: AnalysisCandidate) {
  return candidate.playedAt ? new Date(candidate.playedAt).getTime() || 0 : 0;
}

function sendMessage<T>(payload: unknown): Promise<T> {
  return chrome.runtime.sendMessage(payload);
}

function showMessage(value: string) {
  message.textContent = value;
  savePopupState({ message: value }).catch(() => undefined);
}

async function persistPopupState() {
  await savePopupState({
    matchId: matchIdInput.value,
    selectedMap: selectedMapInput.value,
    analysis: currentAnalysis,
    analysisMinimumSharedPlayers: currentAnalysisMinimumSharedPlayers,
    selectedCandidateIds: [...selectedIds],
    message: message.textContent ?? "",
  });
}

function input(id: string) {
  return element(id) as HTMLInputElement;
}

function element(id: string) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[character] ?? character));
}
