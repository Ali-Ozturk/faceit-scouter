import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, matchPlayer, matchTeam, matchTeamLineup, player, round, roundPositionSample, teamLineup, teamLineupMember } from "@/db/schema";

type ExactLineup = {
  id: string;
  displayName: string;
  playerCount: number;
  memberIds: string[];
  memberNames: string[];
  matchCount: number;
  maps: string | null;
  lastPlayedAt: Date | null;
  lastProcessedAt: Date | null;
};

function groupId(ids: string[]) {
  return `group_${ids.sort().join("_")}`;
}

function parseGroupId(id: string) {
  return id.startsWith("group_") ? id.slice("group_".length).split("_").filter(Boolean) : null;
}

function overlapCount(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id)).length;
}

function buildLineupGroups(lineups: ExactLineup[]) {
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
      if (overlapCount(lineups[i].memberIds, lineups[j].memberIds) >= 4) {
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
    const sorted = [...group].sort((a, b) => {
      const left = a.lastProcessedAt?.getTime() ?? 0;
      const right = b.lastProcessedAt?.getTime() ?? 0;
      return right - left;
    });
    const ids = sorted.map((lineup) => lineup.id);
    const memberNames = [...new Set(sorted.flatMap((lineup) => lineup.memberNames))].sort((a, b) => a.localeCompare(b));
    const maps = [...new Set(sorted.flatMap((lineup) => lineup.maps?.split(", ").filter(Boolean) ?? []))].sort();
    return {
      id: ids.length === 1 ? ids[0] : groupId(ids),
      displayName: memberNames.join(", "),
      playerCount: memberNames.length,
      exactLineupCount: ids.length,
      matchCount: sorted.reduce((total, lineup) => total + lineup.matchCount, 0),
      maps: maps.join(", ") || null,
      lastPlayedAt: sorted.reduce<Date | null>((latest, lineup) => {
        if (!lineup.lastPlayedAt) return latest;
        return !latest || lineup.lastPlayedAt > latest ? lineup.lastPlayedAt : latest;
      }, null),
      lastProcessedAt: sorted[0].lastProcessedAt,
      variantNames: sorted.map((lineup) => lineup.displayName),
    };
  }).sort((a, b) => (b.lastProcessedAt?.getTime() ?? 0) - (a.lastProcessedAt?.getTime() ?? 0));
}

async function getExactLineups(ids?: string[]): Promise<ExactLineup[]> {
  const lineupRows = await db.select().from(teamLineup).where(ids?.length ? inArray(teamLineup.id, ids) : undefined);
  if (lineupRows.length === 0) return [];

  const lineupIds = lineupRows.map((lineup) => lineup.id);
  const memberRows = await db
    .select({
      lineupId: teamLineupMember.teamLineupId,
      playerId: player.id,
      nickname: player.latestNickname,
    })
    .from(teamLineupMember)
    .innerJoin(player, eq(teamLineupMember.playerId, player.id))
    .where(inArray(teamLineupMember.teamLineupId, lineupIds));

  const statsRows = await db
    .select({
      id: teamLineup.id,
      matchCount: count(matchTeamLineup.matchTeamId),
      maps: sql<string>`string_agg(distinct ${csMatch.mapName}, ', ' order by ${csMatch.mapName})`,
      lastPlayedAt: max(csMatch.playedAt),
      lastProcessedAt: max(csMatch.createdAt),
    })
    .from(teamLineup)
    .leftJoin(matchTeamLineup, eq(teamLineup.id, matchTeamLineup.teamLineupId))
    .leftJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .leftJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .where(inArray(teamLineup.id, lineupIds))
    .groupBy(teamLineup.id);

  return lineupRows.map((lineup) => {
    const members = memberRows.filter((member) => member.lineupId === lineup.id);
    const stats = statsRows.find((row) => row.id === lineup.id);
    return {
      id: lineup.id,
      displayName: lineup.displayName,
      playerCount: lineup.playerCount,
      memberIds: members.map((member) => member.playerId),
      memberNames: members.map((member) => member.nickname),
      matchCount: stats?.matchCount ?? 0,
      maps: stats?.maps ?? null,
      lastPlayedAt: stats?.lastPlayedAt ?? null,
      lastProcessedAt: stats?.lastProcessedAt ?? null,
    };
  });
}

export async function getTeams() {
  return buildLineupGroups(await getExactLineups());
}

export async function getTeam(id: string) {
  const groupIds = parseGroupId(id);
  const exactLineups = await getExactLineups(groupIds ?? [id]);
  if (exactLineups.length === 0) return null;
  const lineup = {
    id,
    displayName: [...new Set(exactLineups.flatMap((row) => row.memberNames))].sort((a, b) => a.localeCompare(b)).join(", "),
    fingerprint: id,
    playerCount: [...new Set(exactLineups.flatMap((row) => row.memberIds))].length,
    createdAt: exactLineups[0].lastProcessedAt,
    updatedAt: exactLineups[0].lastProcessedAt,
  };
  const memberIdSet = new Set(exactLineups.flatMap((row) => row.memberIds));
  const members = await db
    .select({ id: player.id, steamId: player.steamId, nickname: player.latestNickname })
    .from(player)
    .where(inArray(player.id, [...memberIdSet]));
  const matches = await db
    .select({
      matchId: csMatch.id,
      mapName: csMatch.mapName,
      playedAt: csMatch.playedAt,
      team1Score: csMatch.team1Score,
      team2Score: csMatch.team2Score,
      teamNumber: matchTeam.teamNumber,
      teamScore: matchTeam.score,
      roundCount: count(round.id),
    })
    .from(matchTeamLineup)
    .innerJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .innerJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .leftJoin(round, eq(round.matchId, csMatch.id))
    .where(inArray(matchTeamLineup.teamLineupId, exactLineups.map((row) => row.id)))
    .groupBy(csMatch.id, matchTeam.teamNumber, matchTeam.score)
    .orderBy(desc(csMatch.playedAt));
  return { lineup, members, matches };
}

export async function getTeamMap(id: string, mapName: string) {
  const team = await getTeam(id);
  if (!team) return null;
  const memberIds = team.members.map((member) => member.id);
  if (memberIds.length === 0) return { ...team, mapName, matches: [], samples: [] };

  const memberList = sql.join(memberIds.map((memberId) => sql`${memberId}`), sql`, `);
  const matches = await db.execute<{
    matchId: string;
    matchTeamId: string;
    displayName: string;
    playedAt: Date | null;
    team1Score: number | null;
    team2Score: number | null;
    startingSide: string | null;
    teamScore: number | null;
    overlapCount: number;
    roundCount: number;
  }>(sql`
    select
      cm.id as "matchId",
      mt.id as "matchTeamId",
      mt.display_name as "displayName",
      cm.played_at as "playedAt",
      cm.team_1_score as "team1Score",
      cm.team_2_score as "team2Score",
      mt.starting_side as "startingSide",
      mt.score as "teamScore",
      count(distinct case when mp.player_id in (${memberList}) then mp.player_id end)::int as "overlapCount",
      count(distinct r.id)::int as "roundCount"
    from match_team mt
    join cs_match cm on cm.id = mt.match_id
    join match_player mp on mp.match_team_id = mt.id
    left join round r on r.match_id = cm.id
    where cm.map_name = ${mapName}
    group by cm.id, mt.id
    having count(distinct case when mp.player_id in (${memberList}) then mp.player_id end) >= 4
    order by cm.played_at desc nulls last, cm.created_at desc
  `);

  const matchTeamIds = matches.map((match) => match.matchTeamId);
  const samples = matchTeamIds.length
    ? await db
        .select({
          matchId: roundPositionSample.matchId,
          matchTeamId: roundPositionSample.matchTeamId,
          roundNumber: roundPositionSample.roundNumber,
          side: roundPositionSample.side,
          seconds: roundPositionSample.seconds,
          tick: roundPositionSample.tick,
          playerName: roundPositionSample.playerName,
          x: roundPositionSample.x,
          y: roundPositionSample.y,
          z: roundPositionSample.z,
          alive: roundPositionSample.alive,
        })
        .from(roundPositionSample)
        .where(inArray(roundPositionSample.matchTeamId, matchTeamIds))
    : [];

  return { ...team, mapName, matches, samples };
}

export async function getTeamMatchPlayers(matchId: string, teamId: string) {
  return db
    .select({
      nickname: matchPlayer.nicknameInMatch,
      kills: matchPlayer.kills,
      deaths: matchPlayer.deaths,
      assists: matchPlayer.assists,
    })
    .from(matchTeamLineup)
    .innerJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .innerJoin(matchPlayer, eq(matchPlayer.matchTeamId, matchTeam.id))
    .where(and(eq(matchTeamLineup.teamLineupId, teamId), eq(matchTeam.matchId, matchId)));
}
