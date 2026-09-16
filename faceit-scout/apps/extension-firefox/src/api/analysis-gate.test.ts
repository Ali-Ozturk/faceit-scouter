import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), store: {} as Record<string, unknown> }));
vi.mock("./backend.js", () => ({ createAnalysis: mocks.create, createAnalysisRequest: (x: unknown) => x, normalizeBackendUrl: (x: string) => x }));
vi.mock("../shared/extension-api.js", () => ({ extensionApi: { storage: { local: { get: async () => mocks.store, set: async (value: object) => Object.assign(mocks.store, value) } } } }));
import { getAnalysisCooldowns, guardedAnalysis } from "./analysis-gate";
const input = { faceitMatchId: "match", requestingPlayerFaceitId: "player", selectedMap: "de_inferno" };
beforeEach(() => {
  mocks.store = {}; mocks.create.mockReset();
  vi.stubGlobal("chrome", { storage: { local: { get: async () => mocks.store, set: async (value: object) => Object.assign(mocks.store, value) } } });
});
it("coalesces rapid identical requests and caches completed results", async () => {
  const result = { analysisId: "one", opponents: [], candidates: [] };
  mocks.create.mockResolvedValue(result);
  const first = guardedAnalysis("https://example.com", input);
  const second = guardedAnalysis("https://example.com", input);
  expect(second).toBe(first);
  expect(await first).toEqual(result);
  expect(await guardedAnalysis("https://example.com", input)).toEqual(result);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("blocks different requests during cooldown, including after popup closure", async () => {
  mocks.store["faceitScoutAnalysisGate:https://example.com:4"] = { key: "previous", until: Date.now() + 6000 };
  await expect(guardedAnalysis("https://example.com", input)).rejects.toThrow("Please wait");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("allows the first three-player fallback immediately after a four-player analysis", async () => {
  mocks.create.mockResolvedValue({ analysisId: "empty", opponents: [], candidates: [] });
  await guardedAnalysis("https://example.com", input);
  await guardedAnalysis("https://example.com", { ...input, minimumSharedPlayers: 3 });
  expect(mocks.create).toHaveBeenCalledTimes(2);
  await expect(guardedAnalysis("https://example.com", { ...input, faceitMatchId: "different" })).rejects.toThrow("Please wait");
});
it("keeps a cooldown after API failures", async () => {
  mocks.create.mockRejectedValue(new Error("Rate limited"));
  await expect(guardedAnalysis("https://example.com", input)).rejects.toThrow("Rate limited");
  await expect(guardedAnalysis("https://example.com", input)).rejects.toThrow("Please wait");
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("exposes the same cooldown timestamps used by the request gate", async () => {
  const until = Date.now() + 6000;
  mocks.store["faceitScoutAnalysisGate:https://example.com:4"] = { key: "previous", until };
  expect(await getAnalysisCooldowns("https://example.com")).toEqual({ 3: 0, 4: until });
});
