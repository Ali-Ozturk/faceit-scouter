import { createAnalysisRequest, normalizeBackendUrl } from "../api/backend.js";
import type { AnalysisResponse, CurrentFaceitMatch, DownloadStatus, ExtensionSettings } from "../shared/types.js";
import { getPopupState, getStoredDownloadStatuses, savePopupState } from "../storage/popup-state.js";

const el = (id: string) => document.getElementById(id)!;
const field = (id: string) => el(id) as HTMLInputElement;
const button = (id: string) => el(id) as HTMLButtonElement;
const DRAFT_KEY = "faceitScoutConnectionDraft";
let settings: ExtensionSettings;
let matchId = "";
let selectedMap = "";
let analysis: AnalysisResponse | null = null;
let minimumPlayers = 4;
let selectedIds = new Set<string>();
let statuses: DownloadStatus[] = [];
let analyzing = false;
let importing = false;
let detecting = false;
let cooldowns: Record<number, number> = {};
let connectionReady = false;

init().catch(error => notice(errorText(error), "error"));

async function init() {
  settings = await send<ExtensionSettings>({ type: "GET_SETTINGS" });
  const draft = (await chrome.storage.local.get(DRAFT_KEY))[DRAFT_KEY] ?? {};
  field("backend-url").value = draft.backendUrl ?? settings.backendUrl;
  field("import-key").value = draft.importKey ?? settings.importKey;
  field("player-id").value = draft.faceitPlayerId ?? settings.faceitPlayerId;
  // Persist drafts on input, before a permission prompt can close the popup.
  for (const id of ["backend-url", "import-key", "player-id"]) {
    field(id).addEventListener("input", () => {
      chrome.storage.local.set({ [DRAFT_KEY]: connectionFields() }).catch(error => notice(errorText(error), "error"));
    });
  }
  button("settings-toggle").onclick = () => openSettings(el("settings").hidden);
  button("settings-close").onclick = () => openSettings(false);
  button("save-connection").onclick = saveConnection;
  button("start-analysis").onclick = () => void analyze(4);
  button("fallback-analysis-button").onclick = () => void analyze(3);
  button("unselect-all").onclick = () => { selectedIds.clear(); renderCandidates(); void persist(); };
  button("download-selected").onclick = () => void importSelected();
  chrome.runtime.onMessage.addListener(payload => {
    if (payload?.type === "DOWNLOAD_PROGRESS") {
      statuses = payload.payload ?? [];
      renderCandidates();
    }
  });
  const stored = await getPopupState();
  matchId = stored.matchId;
  selectedMap = stored.selectedMap;
  analysis = stored.contextKey === contextKey() ? stored.analysis : null;
  minimumPlayers = stored.analysisMinimumSharedPlayers;
  cooldowns = stored.cooldowns ?? {};
  selectedIds = new Set(stored.selectedCandidateIds.slice(0, 3));
  statuses = await getStoredDownloadStatuses();
  await updateConnection();
  renderAnalysis();
  notice(stored.contextKey === contextKey() && stored.message ? stored.message : selectedMap ? "Ready. Analyze to find your opponents’ history." : "Waiting for a matchroom and final map selection.", stored.messageKind ?? "info");
  await detect();
  // Local DOM inspection only. No FACEIT API request is made by this timer.
  setInterval(() => { void detect(); updateButtons(); }, 2000);
}
function connectionFields() {
  return { backendUrl: field("backend-url").value.trim(), importKey: field("import-key").value.trim(), faceitPlayerId: field("player-id").value.trim() };
}
function permissionOrigin(origin: string) { return origin + "/*"; }
async function updateConnection() {
  connectionReady = false;
  try {
    connectionReady = !!settings.faceitPlayerId && settings.importKey.length >= 24
      && await chrome.permissions.contains({ origins: [permissionOrigin(normalizeBackendUrl(settings.backendUrl))] });
  } catch { /* Invalid legacy settings are corrected in the settings panel. */ }
  el("connection-status").textContent = connectionReady ? new URL(settings.backendUrl).host + " · " + settings.faceitPlayerId : "Connection setup needed";
  if (!connectionReady) openSettings(true);
  updateButtons();
}
function openSettings(open: boolean) {
  el("settings").hidden = !open;
  button("settings-toggle").setAttribute("aria-expanded", String(open));
  for (const child of document.querySelectorAll<HTMLElement>("main > :not(header):not(#settings)")) child.inert = open;
  if (open) field("backend-url").focus(); else button("settings-toggle").focus();
}
function saveConnection() {
  try {
    const next = { ...connectionFields(), backendUrl: normalizeBackendUrl(field("backend-url").value) };
    if (next.importKey.length < 24 || !next.faceitPlayerId) throw new Error("Enter your nickname and an import key with at least 24 characters.");
    // Start both synchronously: background owns persistence if the popup closes,
    // and permissions.request still runs inside the direct click gesture.
    const saved = send<ExtensionSettings>({ type: "SAVE_SETTINGS", settings: next });
    const granted = chrome.permissions.request({ origins: [permissionOrigin(next.backendUrl)] });
    Promise.all([saved, granted]).then(async ([value, allowed]) => {
      if ("error" in value) throw new Error(String(value.error));
      settings = value;
      if (!allowed) throw new Error("Permission declined. Your entries are saved; click Save connection to retry.");
      await chrome.storage.local.remove(DRAFT_KEY);
      analysis = null;
      statuses = [];
      selectedIds.clear();
      await updateConnection();
      openSettings(false);
      renderAnalysis();
      await persist();
      notice("Connection saved. Open a matchroom and click Analyze.", "success");
    }).catch(error => notice(errorText(error), "error"));
  } catch (error) { notice(errorText(error), "error"); }
}
async function detect() {
  if (detecting || analyzing || importing) return;
  detecting = true;
  try {
    const current = await send<CurrentFaceitMatch>({ type: "GET_CURRENT_FACEIT_MATCH" });
    if (!current.matchId) {
      // A different browser tab is not a request to discard the last match.
      el("match-summary").textContent = selectedMap ? displayMap(selectedMap) : "Open a FACEIT matchroom";
      el("match-hint").textContent = analysis ? "Saved analysis · return to your matchroom anytime" : "Your previous match stays available while you browse.";
      return;
    }
    if (current.matchId !== matchId) {
      await persist();
      const saved = await getPopupState({ contextKey: contextKey(), matchId: current.matchId });
      matchId = current.matchId;
      selectedMap = saved.selectedMap || current.selectedMap || "";
      analysis = saved.analysis;
      minimumPlayers = saved.analysisMinimumSharedPlayers;
      cooldowns = saved.cooldowns ?? {};
      selectedIds = new Set(saved.selectedCandidateIds);
      renderAnalysis();
      notice(saved.message || (selectedMap ? "Ready. Analyze to find your opponents’ history." : "Waiting for the final map selection."), saved.messageKind ?? "info");
    }
    // A temporarily missing DOM label (tab loading/voting UI) must not erase results.
    if (current.selectedMap && current.selectedMap !== selectedMap) {
      selectedMap = current.selectedMap;
      analysis = null;
      selectedIds.clear();
      renderAnalysis();
      notice("Map selected. Analyze to find your opponents’ history.");
    }
    el("match-summary").textContent = selectedMap ? displayMap(selectedMap) : "Waiting for map voting";
    el("match-hint").textContent = selectedMap ? "Find recent matches from these opponents" : "No analysis requests are made while waiting.";
  } catch (error) { notice(errorText(error), "error"); }
  finally { detecting = false; updateButtons(); }
}
async function analyze(players: number) {
  if (analyzing || importing || Date.now() < (cooldowns[players] ?? 0)) return;
  await detect();
  if (!matchId || !selectedMap || !connectionReady) return;
  // Set before the first request so repeated clicks cannot queue requests.
  if (analyzing) return;
  analyzing = true;
  cooldowns[players] = Date.now() + 6000;
  updateButtons();
  el("fallback-analysis").hidden = true;
  notice("Analyzing opponents… This can take a moment.", "busy");
  try {
    const response = await send<AnalysisResponse | { error: string }>({
      type: "CREATE_ANALYSIS",
      input: createAnalysisRequest({ faceitMatchId: matchId, requestingPlayerFaceitId: settings.faceitPlayerId, selectedMap, minimumSharedPlayers: players }),
    });
    if ("error" in response) throw new Error(response.error);
    analysis = { ...response, candidates: [...response.candidates].sort((a, b) => (Date.parse(b.playedAt ?? "") || 0) - (Date.parse(a.playedAt ?? "") || 0) || a.faceitMatchId.localeCompare(b.faceitMatchId)) };
    minimumPlayers = response.minimumSharedPlayers ?? players;
    selectedIds = new Set(analysis.candidates.filter(c => !c.processed && !unavailable(c.faceitMatchId)).slice(0, 3).map(c => c.faceitMatchId));
    renderAnalysis();
    notice(analysis.candidates.length ? `Found ${analysis.candidates.length} matches with ${minimumPlayers}+ players.` + (response.warnings?.length ? " Some history was unavailable: " + response.warnings.join(" ") : "") : "Analysis complete. No matching history found.", response.warnings?.length ? "info" : "success");
    await persist();
  } catch (error) { notice(errorText(error), "error"); }
  finally { analyzing = false; cooldowns[players] = Date.now() + 6000; updateButtons(); await persist(); }
}
function unavailable(id: string) {
  return statuses.some(s => s.faceitMatchId === id && ["queued", "opening", "downloading", "processing", "completed"].includes(s.state));
}
async function importSelected() {
  if (importing || analyzing || !analysis || !connectionReady) return;
  const candidates = analysis.candidates.filter(c => selectedIds.has(c.faceitMatchId) && !c.processed && !unavailable(c.faceitMatchId));
  if (!candidates.length) return;
  importing = true;
  updateButtons();
  notice(`Submitting ${candidates.length} demos to your backend…`, "busy");
  try {
    const response = await send<{ error?: string; statuses?: DownloadStatus[] }>({ type: "START_DOWNLOADS", candidates, includeProcessed: false, requesterNickname: analysis.requesterNickname, analysisId: analysis.analysisId });
    if (response.error) throw new Error(response.error);
    if (response.statuses) statuses = response.statuses;
    const failed = response.statuses?.filter(s => ["failed", "waiting_for_user", "unavailable"].includes(s.state)) ?? [];
    notice(failed.length ? `${failed.length} demo(s) could not be submitted. Check the details below.` : "Demos submitted. Your backend will download, parse and save them.", failed.length ? "error" : "success");
  } catch (error) { notice(errorText(error), "error"); }
  finally { importing = false; renderCandidates(); await persist(); }
}
function renderAnalysis() {
  el("fallback-analysis").hidden = !(analysis && !analysis.candidates.length && minimumPlayers >= 4);
  el("opponents").replaceChildren();
  for (const opponent of analysis?.opponents ?? []) el("opponents").append(node("span", opponent.nickname, "chip"));
  el("result-count").textContent = analysis ? String(analysis.candidates.length) : "";
  renderCandidates();
}
function renderCandidates() {
  const list = el("candidate-list");
  const candidateIds = new Set(analysis?.candidates.map(candidate => candidate.faceitMatchId) ?? []);
  selectedIds = new Set([...selectedIds].filter(id => candidateIds.has(id)).slice(0, 3));
  list.replaceChildren();
  if (!analysis?.candidates.length) list.append(node("p", analysis ? "No matching historical demos." : "Analyze your opponents to find recent matches on this map.", "empty"));
  for (const candidate of analysis?.candidates ?? []) {
    const status = statuses.find(s => s.faceitMatchId === candidate.faceitMatchId);
    const disabled = candidate.processed || unavailable(candidate.faceitMatchId);
    if (disabled) selectedIds.delete(candidate.faceitMatchId);
    const row = node("article", "", "candidate");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(candidate.faceitMatchId);
    checkbox.disabled = disabled || importing;
    checkbox.setAttribute("aria-label", `Select ${displayMap(candidate.map)} match from ${relativeDate(candidate.playedAt)}`);
    checkbox.onchange = () => {
      if (checkbox.checked && selectedIds.size >= 3) { checkbox.checked = false; notice("Choose up to 3 demos. Unselect one to choose another."); return; }
      if (checkbox.checked) selectedIds.add(candidate.faceitMatchId); else selectedIds.delete(candidate.faceitMatchId);
      updateButtons(); void persist();
    };
    const body = node("div", "", "candidate-body");
    const title = node("div", "", "candidate-title");
    title.append(node("strong", displayMap(candidate.map)), node("span", candidate.processed ? "Processed" : stateLabel(status), candidate.processed || status?.state === "completed" ? "state processed" : "state"));
    const meta = node("p", `${relativeDate(candidate.playedAt)} · ${candidate.sharedPlayerCount} players`, "candidate-meta");
    meta.title = candidate.playedAt ? new Date(candidate.playedAt).toLocaleString() : "Unknown match date";
    const link = document.createElement("a");
    link.textContent = "Open matchroom ↗";
    link.href = `https://www.faceit.com/en/cs2/room/${encodeURIComponent(candidate.faceitMatchId)}`;
    link.target = "_blank"; link.rel = "noreferrer";
    body.append(title, meta, link);
    if (status?.message && ["failed", "waiting_for_user", "unavailable"].includes(status.state)) body.append(node("p", status.message, "candidate-meta"));
    row.append(checkbox, body); list.append(row);
  }
  updateButtons();
}
function updateButtons() {
  const seconds = Math.max(0, Math.ceil(((cooldowns[4] ?? 0) - Date.now()) / 1000));
  button("start-analysis").disabled = !connectionReady || !matchId || !selectedMap || analyzing || importing || seconds > 0;
  button("start-analysis").textContent = analyzing ? "Analyzing…" : seconds ? `Wait ${seconds}s` : "Analyze";
  const fallbackSeconds = Math.max(0, Math.ceil(((cooldowns[3] ?? 0) - Date.now()) / 1000));
  button("fallback-analysis-button").disabled = !connectionReady || !matchId || !selectedMap || analyzing || importing || fallbackSeconds > 0;
  button("fallback-analysis-button").textContent = fallbackSeconds ? `Wait ${fallbackSeconds}s` : "Try 3 players";
  button("download-selected").disabled = !selectedIds.size || importing || analyzing || !connectionReady;
  button("download-selected").textContent = importing ? "Submitting…" : `Import selected${selectedIds.size ? " (" + selectedIds.size + ")" : ""}`;
  button("unselect-all").disabled = !selectedIds.size || importing;
  button("settings-toggle").disabled = analyzing || importing;
  el("selection-count").textContent = `${selectedIds.size} of 3 selected`;
}
function stateLabel(status?: DownloadStatus) {
  const labels: Record<string, string> = { queued: "Queued", opening: "Getting URL", downloading: "Downloading", processing: "Processing", completed: "Processed", failed: "Failed", waiting_for_user: "Needs attention", unavailable: "Unavailable" };
  return status ? labels[status.state] : "Ready";
}
function relativeDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown date";
  const hours = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 3600000));
  if (hours < 1) return "Less than an hour ago";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
function displayMap(map: string | null) { const name = (map ?? "Unknown map").replace(/^de_/, ""); return name.charAt(0).toUpperCase() + name.slice(1); }
function node(tag: string, text: string, className = "") { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; }
function notice(text: string, kind = "info") {
  el("message").textContent = text; el("message").dataset.kind = kind;
  el("settings-message").textContent = text; el("settings-message").dataset.kind = kind;
  el("settings-message").hidden = el("settings").hidden;
  if (settings && matchId) void persist();
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "An unexpected error occurred."; }
function send<T>(payload: unknown): Promise<T> { return chrome.runtime.sendMessage(payload); }
function contextKey() { return JSON.stringify([settings.backendUrl, settings.faceitPlayerId]); }
async function persist() { await savePopupState({ contextKey: contextKey(), cooldowns, messageKind: el("message").dataset.kind, matchId, selectedMap, analysis, analysisMinimumSharedPlayers: minimumPlayers, selectedCandidateIds: [...selectedIds], message: el("message").textContent ?? "" }); }
