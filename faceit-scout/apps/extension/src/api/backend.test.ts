import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalysisRequest, demoJobs, mapAnalysisResponse, normalizeBackendUrl } from "./backend";

afterEach(() => vi.unstubAllGlobals());

describe("backend API helpers", () => {
  it("transmits analysis and display metadata with the demo URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const demo = { faceitMatchId: "match", url: "https://example.com/demo.dem", analysisId: "analysis", requesterNickname: "aliyo", matchPlayedAt: "2026-09-14T10:00:00Z", mapName: "de_inferno" };
    await demoJobs("https://scout.example.com", "test-key-long-enough-for-imports", [demo]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ demos: [demo] });
  });
  it("explains an old backend's HTML response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!DOCTYPE html><html>Not found</html>", { status: 404 })));
    await expect(demoJobs("http://localhost:3101", "test-key-long-enough-for-imports")).rejects.toThrow("docker compose up -d --build");
  });

  it("normalizes backend URLs", () => {
    expect(normalizeBackendUrl("http://localhost:3000///")).toBe("http://localhost:3000");
    expect(normalizeBackendUrl(" ")).toBe("http://localhost:3101");
  });

  it("creates compact analysis request bodies", () => {
    expect(createAnalysisRequest({
      faceitMatchId: " match ",
      requestingPlayerFaceitId: " player ",
      selectedMap: "",
      minimumSharedPlayers: 3,
    })).toEqual({
      faceitMatchId: "match",
      requestingPlayerFaceitId: "player",
      minimumSharedPlayers: 3,
    });
  });

  it("maps backend analysis responses defensively", () => {
    const mapped = mapAnalysisResponse({
      analysisId: "analysis",
      minimumSharedPlayers: 3,
      opponents: [{ faceitPlayerId: "p1", nickname: "Opponent" }],
      candidates: [{
        faceitMatchId: "m1",
        map: "de_nuke",
        sharedPlayerCount: 5,
        playedAt: "2026-07-14T12:00:00Z",
        faceitMatchroomUrl: "https://www.faceit.com/en/cs2/room/m1",
        processed: true,
        processedMatchId: "processed",
      }],
    });

    expect(mapped.candidates[0]).toMatchObject({ faceitMatchId: "m1", processed: true, sharedPlayerCount: 5 });
    expect(mapped.minimumSharedPlayers).toBe(3);
  });
});
