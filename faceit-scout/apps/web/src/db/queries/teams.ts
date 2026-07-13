import { and, count, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, matchPlayer, matchTeam, matchTeamLineup, player, round, teamLineup, teamLineupMember } from "@/db/schema";

export async function getTeams() {
  return db
    .select({
      id: teamLineup.id,
      displayName: teamLineup.displayName,
      playerCount: teamLineup.playerCount,
      matchCount: count(matchTeamLineup.matchTeamId),
      maps: sql<string>`string_agg(distinct ${csMatch.mapName}, ', ' order by ${csMatch.mapName})`,
      lastPlayedAt: max(csMatch.playedAt),
      lastProcessedAt: max(csMatch.createdAt),
    })
    .from(teamLineup)
    .leftJoin(matchTeamLineup, eq(teamLineup.id, matchTeamLineup.teamLineupId))
    .leftJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .leftJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .groupBy(teamLineup.id)
    .orderBy(desc(max(csMatch.createdAt)));
}

export async function getTeam(id: string) {
  const [lineup] = await db.select().from(teamLineup).where(eq(teamLineup.id, id)).limit(1);
  if (!lineup) return null;
  const members = await db
    .select({ id: player.id, steamId: player.steamId, nickname: player.latestNickname })
    .from(teamLineupMember)
    .innerJoin(player, eq(teamLineupMember.playerId, player.id))
    .where(eq(teamLineupMember.teamLineupId, id));
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
    .where(eq(matchTeamLineup.teamLineupId, id))
    .groupBy(csMatch.id, matchTeam.teamNumber, matchTeam.score)
    .orderBy(desc(csMatch.playedAt));
  return { lineup, members, matches };
}

export async function getTeamMap(id: string, mapName: string) {
  const team = await getTeam(id);
  if (!team) return null;
  const matches = await db
    .select({
      matchId: csMatch.id,
      playedAt: csMatch.playedAt,
      team1Score: csMatch.team1Score,
      team2Score: csMatch.team2Score,
      startingSide: matchTeam.startingSide,
      teamScore: matchTeam.score,
      roundCount: count(round.id),
    })
    .from(matchTeamLineup)
    .innerJoin(matchTeam, eq(matchTeamLineup.matchTeamId, matchTeam.id))
    .innerJoin(csMatch, eq(matchTeam.matchId, csMatch.id))
    .leftJoin(round, eq(round.matchId, csMatch.id))
    .where(and(eq(matchTeamLineup.teamLineupId, id), eq(csMatch.mapName, mapName)))
    .groupBy(csMatch.id, matchTeam.startingSide, matchTeam.score)
    .orderBy(desc(csMatch.playedAt));
  return { ...team, mapName, matches };
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
