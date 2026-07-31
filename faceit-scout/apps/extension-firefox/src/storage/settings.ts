import { extensionApi } from "../shared/extension-api.js";
import type { ExtensionSettings } from "../shared/types.js";

const SETTINGS_KEY = "faceitScoutSettings";

export const defaultSettings: ExtensionSettings = {
  backendUrl: "http://localhost:3101",
  faceitPlayerId: "",
  preferredDownloadSubdirectory: "FaceitScout/incoming",
  maxConcurrentDownloads: 2,
};

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
  return { ...defaultSettings, ...(stored[SETTINGS_KEY] ?? {}) };
}

export async function saveSettings(settings: Partial<ExtensionSettings>) {
  const current = await getSettings();
  const next = {
    ...current,
    ...settings,
    maxConcurrentDownloads: clampConcurrency(settings.maxConcurrentDownloads ?? current.maxConcurrentDownloads),
  };
  await extensionApi.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

function clampConcurrency(value: number) {
  return Math.max(1, Math.min(4, Math.floor(value || defaultSettings.maxConcurrentDownloads)));
}
