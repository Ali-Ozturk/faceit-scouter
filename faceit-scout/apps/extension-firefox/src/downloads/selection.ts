import type { AnalysisCandidate } from "../shared/types.js";

export function candidatesForDownload(candidates: AnalysisCandidate[], selectedIds: Set<string>, includeProcessed = false) {
  return candidates.filter((candidate) =>
    selectedIds.has(candidate.faceitMatchId) && (includeProcessed || !candidate.processed),
  );
}

export function unprocessedCandidateIds(candidates: AnalysisCandidate[]) {
  return new Set(candidates.filter((candidate) => !candidate.processed).map((candidate) => candidate.faceitMatchId));
}
