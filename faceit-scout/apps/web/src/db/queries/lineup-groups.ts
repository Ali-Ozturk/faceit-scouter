import { createHash } from "crypto";

export type ExactLineup = {
  id: string;
  displayName: string;
  playerCount: number;
  memberIds: string[];
  memberNames: string[];
  analysisIds: string[];
  matchCount: number;
  maps: string | null;
  lastPlayedAt: Date | string | null;
  lastProcessedAt: Date | string | null;
};

function groupId(ids: string[]) {
  const key = [...ids].sort().join(":");
  return `grp_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function overlapCount(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id)).length;
}

function sharesAnalysis(left: ExactLineup, right: ExactLineup) {
  const rightIds = new Set(right.analysisIds);
  return left.analysisIds.some((id) => rightIds.has(id));
}

export function candidateMatchesLineup(memberNames: string[], sharedPlayers: unknown, sharedPlayerCount: number) {
  if (!Array.isArray(sharedPlayers) || sharedPlayerCount < 1) return false;
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const members = new Set(memberNames.map(normalize));
  const sharedNames = new Set(sharedPlayers.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const nickname = (value as Record<string, unknown>).nickname;
    return typeof nickname === "string" && nickname.trim() ? [normalize(nickname)] : [];
  }));
  return [...sharedNames].filter((name) => members.has(name)).length >= sharedPlayerCount;
}

export function buildLineupGroups(lineups: ExactLineup[]) {
  const parent = new Map(lineups.map((lineup) => [lineup.id, lineup.id]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (let i = 0; i < lineups.length; i += 1) {
    for (let j = i + 1; j < lineups.length; j += 1) {
      if (overlapCount(lineups[i].memberIds, lineups[j].memberIds) >= 4 || sharesAnalysis(lineups[i], lineups[j])) {
        union(lineups[i].id, lineups[j].id);
      }
    }
  }

  const groups = new Map<string, ExactLineup[]>();
  for (const lineup of lineups) {
    const root = find(lineup.id);
    groups.set(root, [...(groups.get(root) ?? []), lineup]);
  }

  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => dateTime(b.lastProcessedAt) - dateTime(a.lastProcessedAt));
    const ids = sorted.map((lineup) => lineup.id);
    const memberNames = [...new Set(sorted.flatMap((lineup) => lineup.memberNames))].sort((a, b) => a.localeCompare(b));
    const maps = [...new Set(sorted.flatMap((lineup) => lineup.maps?.split(", ").filter(Boolean) ?? []))].sort();
    return {
      id: ids.length === 1 ? ids[0] : groupId(ids),
      exactLineupIds: ids,
      displayName: memberNames.join(", "),
      playerCount: memberNames.length,
      exactLineupCount: ids.length,
      matchCount: sorted.reduce((total, lineup) => total + lineup.matchCount, 0),
      maps: maps.join(", ") || null,
      lastPlayedAt: sorted.reduce<Date | string | null>((latest, lineup) => {
        if (!lineup.lastPlayedAt) return latest;
        return !latest || dateTime(lineup.lastPlayedAt) > dateTime(latest) ? lineup.lastPlayedAt : latest;
      }, null),
      lastProcessedAt: sorted[0].lastProcessedAt,
      variantNames: sorted.map((lineup) => lineup.displayName),
    };
  }).sort((a, b) => dateTime(b.lastProcessedAt) - dateTime(a.lastProcessedAt));
}

function dateTime(value: Date | string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}
