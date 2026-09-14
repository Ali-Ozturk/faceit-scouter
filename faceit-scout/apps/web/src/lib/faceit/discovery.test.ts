import { describe, expect, it } from "vitest";
import { discoverFaceitMatches, getOpposingTeam, type FaceitApi, type FaceitHistoryEntry, type FaceitHistoryRequest } from "./discovery";

const allies = players(["a1", "a2", "a3", "a4", "a5"]);
const opponents = players(["o1", "o2", "o3", "o4", "o5"]);

describe("FACEIT discovery", () => {
  it("identifies the opposing faction", () => {
    const team = getOpposingTeam(match("current", allies, opponents), "a1");
    expect(team.faction).toBe("faction2");
    expect(team.players.map((player) => player.faceitPlayerId)).toEqual(["o1", "o2", "o3", "o4", "o5"]);
  });

  it("finds matches shared by at least four teammates", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        shared4: match("shared4", players(["x1", "x2", "x3", "x4", "x5"]), players(["o1", "o2", "o3", "o4", "z1"]), "de_inferno"),
      },
      histories: historyForOpponents({ o1: ["shared4"], o2: ["shared4"], o3: ["shared4"], o4: ["shared4"] }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates).toHaveLength(1);
    expect(result.requesterNickname).toBe(allies[0].nickname);
    expect(result.candidates[0]).toMatchObject({ faceitMatchId: "shared4", sharedPlayerCount: 4, map: "de_inferno" });
  });

  it("pages player history beyond the first 100 matches inside the history window", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        shared4: match("shared4", players(["x1", "x2", "x3", "x4", "x5"]), players(["o1", "o2", "o3", "o4", "z1"]), "de_inferno"),
      },
      histories: {
        o1: pagedHistory("o1", "shared4"),
        o2: pagedHistory("o2", "shared4"),
        o3: pagedHistory("o3", "shared4"),
        o4: pagedHistory("o4", "shared4"),
      },
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" }, { now: new Date("2026-07-22T00:00:00Z") });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ faceitMatchId: "shared4", sharedPlayerCount: 4 });
  });

  it("only includes three-player premades when requested", async () => {
    const faceitApi = api({
      matches: {
        current: match("current", allies, opponents),
        shared3: match("shared3", players(["x1", "x2", "x3", "x4", "x5"]), players(["o1", "o2", "o3", "z1", "z2"]), "de_inferno"),
      },
      histories: historyForOpponents({ o1: ["shared3"], o2: ["shared3"], o3: ["shared3"] }),
    });

    const strict = await discoverFaceitMatches(faceitApi, { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });
    const fallback = await discoverFaceitMatches(
      faceitApi,
      { faceitMatchId: "current", requestingPlayerFaceitId: "a1" },
      { minimumSharedPlayers: 3 },
    );

    expect(strict.candidates).toEqual([]);
    expect(fallback.candidates[0]).toMatchObject({ faceitMatchId: "shared3", sharedPlayerCount: 3 });
  });

  it("rejects matches where shared players were split across teams", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        split: match("split", players(["o1", "o2", "x1", "x2", "x3"]), players(["o3", "o4", "x4", "x5", "x6"])),
      },
      histories: historyForOpponents({ o1: ["split"], o2: ["split"], o3: ["split"], o4: ["split"] }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates).toEqual([]);
  });

  it("excludes the current lobby from historical candidates", async () => {
    const result = await discoverFaceitMatches(api({
      matches: { current: match("current", allies, opponents) },
      histories: historyForOpponents({ o1: ["current"], o2: ["current"], o3: ["current"], o4: ["current"], o5: ["current"] }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates).toEqual([]);
  });

  it("filters by normalized selected map", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        inferno: match("inferno", players(["x1", "x2", "x3", "x4", "x5"]), opponents, "de_inferno"),
        nuke: match("nuke", players(["x1", "x2", "x3", "x4", "x5"]), opponents, "de_nuke"),
      },
      histories: historyForOpponents({
        o1: ["inferno", "nuke"],
        o2: ["inferno", "nuke"],
        o3: ["inferno", "nuke"],
        o4: ["inferno", "nuke"],
        o5: ["inferno", "nuke"],
      }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1", selectedMap: "INFERNO" });

    expect(result.candidates.map((candidate) => candidate.faceitMatchId)).toEqual(["inferno"]);
  });

  it("orders five shared players before four, then newest first", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        old5: match("old5", players(["x1", "x2", "x3", "x4", "x5"]), opponents, "de_mirage", 100),
        new4: match("new4", players(["x1", "x2", "x3", "x4", "x5"]), players(["o1", "o2", "o3", "o4", "z1"]), "de_mirage", 300),
        new5: match("new5", players(["x1", "x2", "x3", "x4", "x5"]), opponents, "de_mirage", 500),
      },
      histories: historyForOpponents({
        o1: ["old5", "new4", "new5"],
        o2: ["old5", "new4", "new5"],
        o3: ["old5", "new4", "new5"],
        o4: ["old5", "new4", "new5"],
        o5: ["old5", "new5"],
      }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates.map((candidate) => candidate.faceitMatchId)).toEqual(["new5", "old5", "new4"]);
  });

  it("extracts candidate dates from alternate FACEIT timestamp fields", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        created: {
          ...match("created", players(["x1", "x2", "x3", "x4", "x5"]), opponents),
          started_at: undefined,
          created_at: 1_720_000_000,
        },
      },
      histories: historyForOpponents({ o1: ["created"], o2: ["created"], o3: ["created"], o4: ["created"], o5: ["created"] }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates[0].playedAt?.getUTCFullYear()).toBe(2024);
  });

  it("returns an empty result when no matches qualify", async () => {
    const result = await discoverFaceitMatches(api({
      matches: { current: match("current", allies, opponents) },
      histories: historyForOpponents({ o1: ["one"], o2: ["two"], o3: ["three"] }),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates).toEqual([]);
  });

  it("continues when one player history request fails", async () => {
    const result = await discoverFaceitMatches(api({
      matches: {
        current: match("current", allies, opponents),
        shared4: match("shared4", players(["x1", "x2", "x3", "x4", "x5"]), players(["o1", "o2", "o3", "o4", "z1"])),
      },
      histories: historyForOpponents({ o1: ["shared4"], o2: ["shared4"], o3: ["shared4"], o4: ["shared4"] }),
      failingHistoryPlayers: new Set(["o5"]),
    }), { faceitMatchId: "current", requestingPlayerFaceitId: "a1" });

    expect(result.candidates).toHaveLength(1);
    expect(result.warnings[0]).toContain("Opponent o5");
  });
});

function api(config: {
  matches: Record<string, unknown>;
  histories: Record<string, FaceitHistoryEntry[]>;
  failingHistoryPlayers?: Set<string>;
}): FaceitApi {
  return {
    async getMatch(matchId) {
      const found = config.matches[matchId];
      if (!found) throw new Error(`Missing match ${matchId}`);
      return found;
    },
    async getPlayerHistory(playerId, request: FaceitHistoryRequest) {
      if (config.failingHistoryPlayers?.has(playerId)) throw new Error("rate limited");
      const history = config.histories[playerId] ?? [];
      return history.slice(request.offset, request.offset + request.limit);
    },
  };
}

function historyForOpponents(entries: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(entries).map(([playerId, matchIds]) => [
    playerId,
    matchIds.map((matchId, index) => ({ matchId, playedAt: new Date((index + 1) * 1000) })),
  ]));
}

function pagedHistory(playerId: string, sharedMatchId: string) {
  return [
    ...Array.from({ length: 100 }, (_, index) => ({
      matchId: `${playerId}-recent-${index}`,
      playedAt: new Date((index + 1) * 1000),
    })),
    { matchId: sharedMatchId, playedAt: new Date(200_000) },
  ];
}

function match(matchId: string, faction1: ReturnType<typeof players>, faction2: ReturnType<typeof players>, mapName = "de_mirage", startedAt = 1000) {
  return {
    match_id: matchId,
    started_at: startedAt,
    voting: { map: { pick: [mapName] } },
    teams: {
      faction1: { roster: faction1 },
      faction2: { roster: faction2 },
    },
  };
}

function players(ids: string[]) {
  return ids.map((id) => ({ player_id: id, nickname: id.startsWith("o") ? `Opponent ${id}` : `Ally ${id}` }));
}
