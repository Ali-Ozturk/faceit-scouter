import { beforeEach, expect, it, vi } from "vitest";
import { getPopupState, savePopupState } from "./popup-state";
const records = vi.hoisted(() => ({} as Record<string, unknown>));
beforeEach(() => {
  for (const key of Object.keys(records)) delete records[key];
  vi.stubGlobal("chrome", { storage: { local: { get: async () => records, set: async (value: object) => Object.assign(records, value) } } });
});
it("retains each match and its message when another match is viewed", async () => {
  await savePopupState({ contextKey: "server-and-player", matchId: "first", selectedMap: "de_inferno", message: "Demos submitted", messageKind: "success" });
  await savePopupState({ contextKey: "server-and-player", matchId: "second", selectedMap: "de_nuke", message: "Nothing found" });
  const first = await getPopupState({ contextKey: "server-and-player", matchId: "first" });
  expect(first.selectedMap).toBe("de_inferno");
  expect(first.message).toBe("Demos submitted");
  expect(first.messageKind).toBe("success");
  expect((await getPopupState()).matchId).toBe("second");
});
it("does not restore another backend or player's results", async () => {
  await savePopupState({ contextKey: "server-a", matchId: "first", message: "A result" });
  expect((await getPopupState({ contextKey: "server-b", matchId: "first" })).message).toBe("");
});
