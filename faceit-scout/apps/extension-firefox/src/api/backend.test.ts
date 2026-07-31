import { describe, expect, it } from "vitest";
import { createAnalysisRequest, mapAnalysisResponse, normalizeBackendUrl } from "./backend";

describe("backend API helpers", () => {
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
