import { describe, expect, it } from "vitest";
import { createDemoFilename } from "./filename";
import { runBoundedQueue } from "./queue";
import { candidatesForDownload, unprocessedCandidateIds } from "./selection";
import type { AnalysisCandidate } from "../shared/types";

const candidates: AnalysisCandidate[] = [
  candidate("m1", false),
  candidate("m2", true),
  candidate("m3", false),
];

describe("download helpers", () => {
  it("generates predictable demo filenames", () => {
    expect(createDemoFilename("1:bad/match", "FaceitScout/incoming")).toBe("FaceitScout/incoming/1_bad_match.dem.zst");
  });

  it("selects unprocessed candidates by default", () => {
    expect([...unprocessedCandidateIds(candidates)]).toEqual(["m1", "m3"]);
    expect(candidatesForDownload(candidates, new Set(["m1", "m2"]), false).map((item) => item.faceitMatchId)).toEqual(["m1"]);
  });

  it("can include processed candidates explicitly", () => {
    expect(candidatesForDownload(candidates, new Set(["m2"]), true).map((item) => item.faceitMatchId)).toEqual(["m2"]);
  });

  it("honors bounded concurrency and continues after failures", async () => {
    let active = 0;
    let maxActive = 0;
    const errors: string[] = [];
    await runBoundedQueue([1, 2, 3, 4], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (item === 3) throw new Error("failed");
      return item;
    }, ({ error }) => {
      if (error) errors.push(error.message);
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(errors).toEqual(["failed"]);
  });
});

function candidate(faceitMatchId: string, processed: boolean): AnalysisCandidate {
  return {
    faceitMatchId,
    map: "de_mirage",
    sharedPlayerCount: 4,
    playedAt: null,
    faceitMatchroomUrl: `https://www.faceit.com/en/cs2/room/${faceitMatchId}`,
    processed,
    processedMatchId: processed ? "processed" : null,
  };
}
