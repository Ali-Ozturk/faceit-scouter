import { describe, expect, it } from "vitest";
import { buildLineupGroups, candidateMatchesLineup, type ExactLineup } from "./lineup-groups";

describe("lineup groups", () => {
  it("groups selected candidate lineups from one analysis even when their four-player subsets differ", () => {
    const groups = buildLineupGroups([
      lineup("first", ["blodnabb", "grilldress", "louieyo", "majoreN-", "Napoleon_G"], ["analysis"]),
      lineup("second", ["blodnabb", "grilldress", "louieyo", "majoreN-", "MATTEK1NG"], ["analysis"]),
      lineup("third", ["blodnabb", "grilldress", "louieyo", "Torretore", "wekonz"], ["analysis"]),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ exactLineupCount: 3, matchCount: 3, playerCount: 8 });
  });

  it("only associates the relevant side of an analyzed match", () => {
    const shared = ["blodnabb", "grilldress", "louieyo", "Torretore"].map((nickname) => ({ nickname }));
    expect(candidateMatchesLineup(["blodnabb", "grilldress", "louieyo", "Torretore", "wekonz"], shared, 4)).toBe(true);
    expect(candidateMatchesLineup(["Evil_empire", "JackiEZ", "squirtle", "YARDEN", "yotsubane"], shared, 4)).toBe(false);
  });

  it("still groups lineups with four shared players without analysis metadata", () => {
    const groups = buildLineupGroups([
      lineup("first", ["a", "b", "c", "d", "x"]),
      lineup("second", ["a", "b", "c", "d", "y"]),
    ]);
    expect(groups).toHaveLength(1);
  });
});

function lineup(id: string, names: string[], analysisIds: string[] = []): ExactLineup {
  return {
    id,
    displayName: names.join(", "),
    playerCount: names.length,
    memberIds: names,
    memberNames: names,
    analysisIds,
    matchCount: 1,
    maps: "de_nuke",
    lastPlayedAt: new Date("2026-09-16T18:35:00Z"),
    lastProcessedAt: new Date("2026-09-16T18:35:00Z"),
  };
}
