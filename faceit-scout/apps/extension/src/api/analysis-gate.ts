import { createAnalysis, createAnalysisRequest, normalizeBackendUrl } from "./backend.js";
import type { AnalysisResponse, BackendAnalysisInput } from "../shared/types.js";

const KEY = "faceitScoutAnalysisGate";
let running: Promise<AnalysisResponse> | null = null;
let runningKey = "";
type Record = { key: string; until: number; result?: AnalysisResponse; expires?: number };

export function guardedAnalysis(backend: string, input: BackendAnalysisInput): Promise<AnalysisResponse> {
  const key = JSON.stringify([normalizeBackendUrl(backend), createAnalysisRequest(input)]);
  if (running) return runningKey === key ? running : Promise.reject(new Error("An analysis is already running. Please wait."));
  runningKey = key;
  running = run(backend, input, key).finally(() => { running = null; runningKey = ""; });
  return running;
}

async function run(backend: string, input: BackendAnalysisInput, key: string) {
  const bucket = `${KEY}:${normalizeBackendUrl(backend)}:${input.minimumSharedPlayers ?? 4}`;
  const saved = (await chrome.storage.local.get(bucket))[bucket] as Record | undefined;
  if (saved?.key === key && saved.result && (saved.expires ?? 0) > Date.now()) return saved.result;
  if (saved && saved.until > Date.now()) throw new Error(`Please wait ${Math.ceil((saved.until - Date.now()) / 1000)} seconds before another analysis.`);
  // The lease survives a closed popup or restarted extension worker.
  await chrome.storage.local.set({ [bucket]: { key, until: Date.now() + 120000 } });
  try {
    const result = await createAnalysis(backend, input);
    await chrome.storage.local.set({ [bucket]: { key, until: Date.now() + 6000, result, expires: Date.now() + 60000 } });
    return result;
  } catch (error) {
    await chrome.storage.local.set({ [bucket]: { key, until: Date.now() + 6000 } });
    throw error;
  }
}
