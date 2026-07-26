export type FaceitPlayer = {
  faceitPlayerId: string;
  nickname: string;
};

export type FaceitHistoryEntry = {
  matchId: string;
  playedAt?: Date | null;
};

export type FaceitHistoryRequest = {
  from: Date;
  to: Date;
  offset: number;
  limit: number;
};

export type FaceitApi = {
  getMatch(matchId: string): Promise<unknown>;
  getPlayerHistory(playerId: string, request: FaceitHistoryRequest): Promise<FaceitHistoryEntry[]>;
};

export type DiscoveryInput = {
  faceitMatchId: string;
  requestingPlayerFaceitId: string;
  selectedMap?: string | null;
  minimumSharedPlayers?: number;
};

export type DiscoveryCandidate = {
  faceitMatchId: string;
  map: string | null;
  sharedPlayerCount: number;
  sharedPlayers: FaceitPlayer[];
  playedAt: Date | null;
  faceitMatchroomUrl: string;
};

export type DiscoveryResult = {
  opponents: FaceitPlayer[];
  opponentFaction: string;
  candidates: DiscoveryCandidate[];
  warnings: string[];
};

type FaceitTeam = {
  faction: string;
  players: FaceitPlayer[];
};

const MAP_ALIASES = new Map<string, string>([
  ["ancient", "de_ancient"],
  ["anubis", "de_anubis"],
  ["cache", "de_cache"],
  ["dust2", "de_dust2"],
  ["dust 2", "de_dust2"],
  ["inferno", "de_inferno"],
  ["mirage", "de_mirage"],
  ["nuke", "de_nuke"],
  ["overpass", "de_overpass"],
  ["train", "de_train"],
  ["vertigo", "de_vertigo"],
]);

export function normalizeMapName(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  if (normalized.startsWith("de_")) return normalized;
  return MAP_ALIASES.get(normalized) ?? `de_${normalized.replace(/\s+/g, "_")}`;
}

export function getMatchroomUrl(faceitMatchId: string) {
  return `https://www.faceit.com/en/cs2/room/${encodeURIComponent(faceitMatchId)}`;
}

export function getOpposingTeam(match: unknown, requestingPlayerFaceitId: string) {
  const teams = extractTeams(match);
  const requesterId = requestingPlayerFaceitId.toLowerCase();
  const requestingTeam = teams.find((team) =>
    team.players.some((player) => player.faceitPlayerId.toLowerCase() === requesterId),
  );

  if (!requestingTeam) {
    throw new Error("Requesting player was not found in the current FACEIT match.");
  }

  const opponentTeam = teams.find((team) => team.faction !== requestingTeam.faction);
  if (!opponentTeam) {
    throw new Error("Could not identify the opposing FACEIT faction.");
  }

  return opponentTeam;
}

export async function discoverFaceitMatches(
  api: FaceitApi,
  input: DiscoveryInput,
  options: {
    historyWindowMonths?: number;
    historyPageSize?: number;
    maxHistoryOffset?: number;
    minimumSharedPlayers?: number;
    detailConcurrency?: number;
    now?: Date;
  } = {},
): Promise<DiscoveryResult> {
  const historyWindowMonths = options.historyWindowMonths ?? 3;
  const historyPageSize = options.historyPageSize ?? 100;
  const maxHistoryOffset = options.maxHistoryOffset ?? 1000;
  const minimumSharedPlayers = options.minimumSharedPlayers ?? 4;
  const detailConcurrency = options.detailConcurrency ?? 5;
  const historyTo = options.now ?? new Date();
  const historyFrom = subtractMonths(historyTo, historyWindowMonths);
  const selectedMap = normalizeMapName(input.selectedMap);
  const currentMatch = await api.getMatch(input.faceitMatchId);
  const opponentTeam = getOpposingTeam(currentMatch, input.requestingPlayerFaceitId);
  const opponentIds = new Set(opponentTeam.players.map((player) => player.faceitPlayerId.toLowerCase()));
  const warnings: string[] = [];
  const matchIndex = new Map<string, { playerIds: Set<string>; playedAt: Date | null }>();

  await Promise.all(opponentTeam.players.map(async (opponent) => {
    try {
      const historyResult = await fetchPlayerHistoryWindow(api, opponent.faceitPlayerId, {
        from: historyFrom,
        to: historyTo,
        pageSize: historyPageSize,
        maxOffset: maxHistoryOffset,
      });
      if (historyResult.reachedOffsetLimit) {
        warnings.push(`FACEIT history for ${opponent.nickname} reached the API offset limit before the 3-month window was exhausted.`);
      }
      const history = historyResult.items;
      for (const entry of history) {
        if (!entry.matchId || entry.matchId === input.faceitMatchId) continue;
        const indexed = matchIndex.get(entry.matchId) ?? { playerIds: new Set<string>(), playedAt: null };
        indexed.playerIds.add(opponent.faceitPlayerId.toLowerCase());
        indexed.playedAt = latestDate(indexed.playedAt, entry.playedAt ?? null);
        matchIndex.set(entry.matchId, indexed);
      }
    } catch (error) {
      warnings.push(`Could not fetch match history for ${opponent.nickname}: ${errorMessage(error)}`);
    }
  }));

  const detailIds = [...matchIndex.entries()]
    .filter(([, entry]) => entry.playerIds.size >= minimumSharedPlayers)
    .map(([matchId]) => matchId);

  const candidates = await mapWithConcurrency(detailIds, detailConcurrency, async (matchId) => {
    try {
      const match = await api.getMatch(matchId);
      const matchMap = extractMap(match);
      if (selectedMap && matchMap !== selectedMap) return null;
      const verified = findSharedTeammates(match, opponentTeam.players, opponentIds);
      if (verified.length < minimumSharedPlayers) return null;
      return {
        faceitMatchId: matchId,
        map: matchMap,
        sharedPlayerCount: verified.length,
        sharedPlayers: verified,
        playedAt: extractPlayedAt(match) ?? matchIndex.get(matchId)?.playedAt ?? null,
        faceitMatchroomUrl: getMatchroomUrl(matchId),
      };
    } catch (error) {
      warnings.push(`Could not verify match ${matchId}: ${errorMessage(error)}`);
      return null;
    }
  });

  return {
    opponents: opponentTeam.players,
    opponentFaction: opponentTeam.faction,
    candidates: candidates
      .filter((candidate): candidate is DiscoveryCandidate => candidate !== null)
      .sort((left, right) => compareCandidates(left, right, selectedMap)),
    warnings,
  };
}

async function fetchPlayerHistoryWindow(
  api: FaceitApi,
  playerId: string,
  options: { from: Date; to: Date; pageSize: number; maxOffset: number },
) {
  const pageSize = clampInteger(options.pageSize, 1, 100);
  const maxOffset = Math.max(0, options.maxOffset);
  const history: FaceitHistoryEntry[] = [];
  let reachedOffsetLimit = false;

  for (let offset = 0; offset <= maxOffset; offset += pageSize) {
    const page = await api.getPlayerHistory(playerId, {
      from: options.from,
      to: options.to,
      offset,
      limit: pageSize,
    });
    history.push(...page);
    if (page.length < pageSize) break;
    reachedOffsetLimit = offset + pageSize > maxOffset;
  }

  return { items: history, reachedOffsetLimit };
}

function compareCandidates(left: DiscoveryCandidate, right: DiscoveryCandidate, selectedMap: string | null) {
  const sharedDelta = right.sharedPlayerCount - left.sharedPlayerCount;
  if (sharedDelta !== 0) return sharedDelta;
  if (selectedMap) {
    const mapDelta = Number(right.map === selectedMap) - Number(left.map === selectedMap);
    if (mapDelta !== 0) return mapDelta;
  }
  return (right.playedAt?.getTime() ?? 0) - (left.playedAt?.getTime() ?? 0);
}

function findSharedTeammates(match: unknown, opponents: FaceitPlayer[], opponentIds: Set<string>) {
  const opponentById = new Map(opponents.map((player) => [player.faceitPlayerId.toLowerCase(), player]));
  const teams = extractTeams(match);
  const sharedByTeam = teams.map((team) =>
    team.players
      .filter((player) => opponentIds.has(player.faceitPlayerId.toLowerCase()))
      .map((player) => opponentById.get(player.faceitPlayerId.toLowerCase()) ?? player),
  );
  return sharedByTeam.sort((left, right) => right.length - left.length)[0] ?? [];
}

function extractTeams(match: unknown): FaceitTeam[] {
  const teamsValue = getRecord(match).teams;
  const teamsRecord = getRecord(teamsValue);
  return Object.entries(teamsRecord)
    .map(([faction, value]) => {
      const team = getRecord(value);
      const roster = Array.isArray(team.roster) ? team.roster : Array.isArray(team.players) ? team.players : [];
      return {
        faction,
        players: roster.map(parsePlayer).filter((player): player is FaceitPlayer => player !== null),
      };
    })
    .filter((team) => team.players.length > 0);
}

function parsePlayer(value: unknown): FaceitPlayer | null {
  const player = getRecord(value);
  const faceitPlayerId = stringValue(player.player_id ?? player.playerId ?? player.faceit_player_id);
  if (!faceitPlayerId) return null;
  return {
    faceitPlayerId,
    nickname: stringValue(player.nickname ?? player.name) ?? faceitPlayerId,
  };
}

function extractMap(match: unknown): string | null {
  const root = getRecord(match);
  const voting = getRecord(root.voting);
  const votingMap = getRecord(voting.map);
  const pick = Array.isArray(votingMap.pick) ? stringValue(votingMap.pick[0]) : null;
  const roundStats = getRecord(root.round_stats);
  const stats = getRecord(root.stats);

  return normalizeMapName(
    pick ??
    stringValue(votingMap.name) ??
    stringValue(roundStats.Map ?? roundStats.map) ??
    stringValue(stats.map) ??
    stringValue(root.map_name ?? root.map),
  );
}

function extractPlayedAt(match: unknown): Date | null {
  const root = getRecord(match);
  return dateValue(root.started_at ?? root.startedAt ?? root.finished_at ?? root.finishedAt ?? root.played_at ?? root.playedAt ?? root.configured_at ?? root.created_at ?? root.createdAt);
}

function latestDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

function subtractMonths(value: Date, months: number) {
  const copy = new Date(value.getTime());
  copy.setUTCMonth(copy.getUTCMonth() - months);
  return copy;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value);
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown FACEIT API error";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
