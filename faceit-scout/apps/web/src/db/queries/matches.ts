import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { bombEvent, csMatch, grenadeEvent, killEvent, matchPlayer, matchTeam, player, round } from "@/db/schema";

export async function getMatch(id: string) {
  const [match] = await db.select().from(csMatch).where(eq(csMatch.id, id)).limit(1);
  if (!match) return null;
  const teams = await db.select().from(matchTeam).where(eq(matchTeam.matchId, id)).orderBy(asc(matchTeam.teamNumber));
  const players = await db
    .select({
      teamId: matchPlayer.matchTeamId,
      nickname: matchPlayer.nicknameInMatch,
      steamId: player.steamId,
      kills: matchPlayer.kills,
      deaths: matchPlayer.deaths,
      assists: matchPlayer.assists,
      headshots: matchPlayer.headshots,
      damage: matchPlayer.damage,
      kast: matchPlayer.kast,
      rating: matchPlayer.rating,
    })
    .from(matchPlayer)
    .innerJoin(player, eq(matchPlayer.playerId, player.id))
    .where(eq(matchPlayer.matchId, id));
  const rounds = await db.select().from(round).where(eq(round.matchId, id)).orderBy(asc(round.roundNumber));
  const kills = await db.select().from(killEvent).where(eq(killEvent.matchId, id)).orderBy(asc(killEvent.sequenceNumber)).limit(50);
  const bombs = await db.select().from(bombEvent).where(eq(bombEvent.matchId, id)).orderBy(asc(bombEvent.sequenceNumber)).limit(50);
  const grenades = await db.select().from(grenadeEvent).where(eq(grenadeEvent.matchId, id)).orderBy(asc(grenadeEvent.sequenceNumber)).limit(50);
  return { match, teams, players, rounds, kills, bombs, grenades };
}
