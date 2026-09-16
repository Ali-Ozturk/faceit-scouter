import { and, count, countDistinct, desc, eq, inArray, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, faceitAnalysisCandidate, grenadeEvent, matchPlayer, matchTeam, matchTeamLineup, player, round, roundPlayerLoadout, roundPositionSample, teamLineup, teamLineupMember } from "@/db/schema";
import { buildLineupGroups, candidateMatchesLineup, type ExactLineup } from "@/db/queries/lineup-groups";

function parseGroupId(id: string) {
  return id.startsWith("group_") ? id.slice("group_".length).split("_").filter(Boolean) : null;
}

function faceitCandidateMatchCondition() {
  return sql`
    ${faceitAnalysisCandidate.processedMatchId} = ${csMatch.id}
    or (
      ${csMatch.faceitMatchId} is not null
      and ${faceitAnalysisCandidate.faceitMatchId} is not null
      and regexp_replace(${faceitAnalysisCandidate.faceitMatchId}, '^[0-9]-', '') = regexp_replace(${csMatch.faceitMatchId}, '^[0-9]-', '')
    )
  `;
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

  const candidateRows = await db
    .select({
      lineupId: matchTeamLineup.teamLineupId,
      candidateId: faceitAnalysisCandidate.id,
      analysisId: faceitAnalysisCandidate.analysisId,
      sharedPlayerCount: faceitAnalysisCandidate.sharedPlayerCount,
      sharedPlayers: faceitAnalysisCandidate.sharedPlayersJson,
      nicknameInMatch: matchPlayer.nicknameInMatch,
    })
    .from(matchTeamLineup)
    .innerJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .innerJoin(matchPlayer, eq(matchPlayer.matchTeamId, matchTeam.id))
    .innerJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .innerJoin(faceitAnalysisCandidate, faceitCandidateMatchCondition())
    .where(inArray(matchTeamLineup.teamLineupId, lineupIds));

  const statsRows = await db
    .select({
      id: teamLineup.id,
      matchCount: countDistinct(matchTeamLineup.matchTeamId),
      maps: sql<string>`string_agg(distinct ${csMatch.mapName}, ', ' order by ${csMatch.mapName})`,
      lastPlayedAt: max(sql<Date>`coalesce(${csMatch.playedAt}, ${faceitAnalysisCandidate.playedAt})`),
      lastProcessedAt: max(csMatch.createdAt),
    })
    .from(teamLineup)
    .leftJoin(matchTeamLineup, eq(teamLineup.id, matchTeamLineup.teamLineupId))
    .leftJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .leftJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .leftJoin(faceitAnalysisCandidate, faceitCandidateMatchCondition())
    .where(inArray(teamLineup.id, lineupIds))
    .groupBy(teamLineup.id);

  return lineupRows.map((lineup) => {
    const members = memberRows.filter((member) => member.lineupId === lineup.id);
    const stats = statsRows.find((row) => row.id === lineup.id);
    const candidateLinks = new Map<string, (typeof candidateRows)[number][]>();
    for (const candidate of candidateRows.filter((row) => row.lineupId === lineup.id)) {
      candidateLinks.set(candidate.candidateId, [...(candidateLinks.get(candidate.candidateId) ?? []), candidate]);
    }
    const analysisIds = [...new Set([...candidateLinks.values()]
      .filter((rows) => candidateMatchesLineup(rows.map((row) => row.nicknameInMatch), rows[0].sharedPlayers, rows[0].sharedPlayerCount))
      .map((rows) => rows[0].analysisId))];
    return {
      id: lineup.id,
      displayName: lineup.displayName,
      playerCount: lineup.playerCount,
      memberIds: members.map((member) => member.playerId),
      memberNames: members.map((member) => member.nickname),
      analysisIds,
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
  const resolvedIds = groupIds ?? await exactLineupIdsForShortGroup(id);
  const exactLineups = await getExactLineups(resolvedIds ?? [id]);
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
      playedAt: sql<Date | null>`coalesce(${csMatch.playedAt}, max(${faceitAnalysisCandidate.playedAt}))`,
      team1Score: csMatch.team1Score,
      team2Score: csMatch.team2Score,
      teamNumber: matchTeam.teamNumber,
      teamScore: matchTeam.score,
      roundCount: countDistinct(round.id),
    })
    .from(matchTeamLineup)
    .innerJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .innerJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .leftJoin(faceitAnalysisCandidate, faceitCandidateMatchCondition())
    .leftJoin(round, eq(round.matchId, csMatch.id))
    .where(inArray(matchTeamLineup.teamLineupId, exactLineups.map((row) => row.id)))
    .groupBy(csMatch.id, matchTeam.teamNumber, matchTeam.score)
    .orderBy(desc(sql`coalesce(${csMatch.playedAt}, max(${faceitAnalysisCandidate.playedAt}))`));
  return { lineup, members, matches };
}

export async function getTeamMap(id: string, mapName: string) {
  const team = await getTeam(id);
  if (!team) return null;
  const memberIds = team.members.map((member) => member.id);
  if (memberIds.length === 0) return { ...team, mapName, matches: [], samples: [], utilities: [], rounds: [] };

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
      coalesce(cm.played_at, max(fac.played_at)) as "playedAt",
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
    left join faceit_analysis_candidate fac on (
      fac.processed_match_id = cm.id
      or (
        cm.faceit_match_id is not null
        and fac.faceit_match_id is not null
        and regexp_replace(fac.faceit_match_id, '^[0-9]-', '') = regexp_replace(cm.faceit_match_id, '^[0-9]-', '')
      )
    )
    where cm.map_name = ${mapName}
    group by cm.id, mt.id
    having count(distinct case when mp.player_id in (${memberList}) then mp.player_id end) >= 4
    order by coalesce(cm.played_at, max(fac.played_at)) desc nulls last, cm.created_at desc
  `);

  const matchTeamIds = matches.map((match) => match.matchTeamId);
  const matchIds = matches.map((match) => match.matchId);
  const samples = matchTeamIds.length
    ? await db
        .select({
          matchId: roundPositionSample.matchId,
          matchTeamId: roundPositionSample.matchTeamId,
          playerId: roundPositionSample.playerId,
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
  const loadouts = matchIds.length
    ? await db
        .select({
          matchId: roundPlayerLoadout.matchId,
          playerId: roundPlayerLoadout.playerId,
          roundNumber: roundPlayerLoadout.roundNumber,
          weapon: roundPlayerLoadout.weapon,
          utility: roundPlayerLoadout.utility,
          inventory: roundPlayerLoadout.inventory,
        })
        .from(roundPlayerLoadout)
        .where(inArray(roundPlayerLoadout.matchId, matchIds))
    : [];
  const loadoutBySample = new Map(loadouts.map((loadout) => [
    loadoutKey(loadout.matchId, loadout.playerId, loadout.roundNumber),
    loadout,
  ]));
  const samplesWithLoadouts = samples.map((sample) => {
    const loadout = loadoutBySample.get(loadoutKey(sample.matchId, sample.playerId, sample.roundNumber));
    return {
      ...sample,
      weapon: loadout?.weapon ?? null,
      utility: loadout?.utility ?? null,
      inventory: loadout?.inventory ?? null,
    };
  });
  const utilities = matchIds.length
    ? await db
        .select({
          id: grenadeEvent.id,
          matchId: grenadeEvent.matchId,
          throwerPlayerId: grenadeEvent.throwerPlayerId,
          throwerTeamId: grenadeEvent.throwerTeamId,
          roundNumber: round.roundNumber,
          grenadeType: grenadeEvent.grenadeType,
          flightStartSeconds: sql<number | null>`case
            when ${grenadeEvent.thrownDemoTime} is null then null
            else greatest(0, (${grenadeEvent.thrownDemoTime} - coalesce(${round.startedAtDemoTime}, ${grenadeEvent.thrownDemoTime})) / coalesce(nullif(${csMatch.tickRate}, 0), 64))
          end`,
          seconds: sql<number>`greatest(0, (${grenadeEvent.demoTime} - coalesce(${round.startedAtDemoTime}, ${grenadeEvent.demoTime})) / coalesce(nullif(${csMatch.tickRate}, 0), 64))`,
          durationSeconds: sql<number>`case
            when lower(${grenadeEvent.grenadeType}) like '%smoke%' then 18
            when lower(${grenadeEvent.grenadeType}) like '%molotov%' or lower(${grenadeEvent.grenadeType}) like '%inc%' then 7
            else 2
          end`,
          startX: grenadeEvent.startX,
          startY: grenadeEvent.startY,
          startZ: grenadeEvent.startZ,
          endX: grenadeEvent.endX,
          endY: grenadeEvent.endY,
          endZ: grenadeEvent.endZ,
          throwerName: player.latestNickname,
        })
        .from(grenadeEvent)
        .innerJoin(csMatch, eq(grenadeEvent.matchId, csMatch.id))
        .leftJoin(round, eq(grenadeEvent.roundId, round.id))
        .leftJoin(player, eq(grenadeEvent.throwerPlayerId, player.id))
        .where(inArray(grenadeEvent.matchId, matchIds))
    : [];
  const rounds = matchIds.length
    ? await db
        .select({
          matchId: round.matchId,
          roundNumber: round.roundNumber,
          winnerMatchTeamId: round.winnerMatchTeamId,
        })
        .from(round)
        .where(inArray(round.matchId, matchIds))
    : [];

  return { ...team, mapName, matches, samples: samplesWithLoadouts, utilities, rounds };
}

function loadoutKey(matchId: string, playerId: string, roundNumber: number) {
  return `${matchId}:${playerId}:${roundNumber}`;
}

async function exactLineupIdsForShortGroup(id: string) {
  if (!id.startsWith("grp_")) return null;
  const group = buildLineupGroups(await getExactLineups()).find((lineup) => lineup.id === id);
  return group?.exactLineupIds ?? null;
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
