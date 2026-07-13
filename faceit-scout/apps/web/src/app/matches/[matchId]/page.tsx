import { notFound } from "next/navigation";
import { getMatch } from "@/db/queries/matches";
import { formatDate } from "@/lib/format";
import { Table, Td, Th } from "@/components/table";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const data = await getMatch(matchId);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{data.match.mapName}</h1>
        <p className="mt-2 text-slate-600">{formatDate(data.match.playedAt)} · {data.match.team1Score ?? "-"} : {data.match.team2Score ?? "-"}</p>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        {data.teams.map((team) => (
          <div key={team.id} className="rounded border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">{team.displayName}</h2>
            <p className="text-sm text-slate-600">Team {team.teamNumber} · {team.startingSide ?? "unknown"} · score {team.score ?? "-"}</p>
          </div>
        ))}
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Players</h2>
        <Table>
          <thead><tr><Th>Player</Th><Th>K</Th><Th>D</Th><Th>A</Th><Th>HS</Th><Th>Damage</Th></tr></thead>
          <tbody>{data.players.map((player) => <tr key={`${player.teamId}-${player.steamId}`}><Td>{player.nickname}</Td><Td>{player.kills ?? "-"}</Td><Td>{player.deaths ?? "-"}</Td><Td>{player.assists ?? "-"}</Td><Td>{player.headshots ?? "-"}</Td><Td>{player.damage ?? "-"}</Td></tr>)}</tbody>
        </Table>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Rounds</h2>
        <Table>
          <thead><tr><Th>#</Th><Th>Winner</Th><Th>Side</Th><Th>Reason</Th><Th>Site</Th><Th>Opening kill</Th></tr></thead>
          <tbody>{data.rounds.map((round) => <tr key={round.id}><Td>{round.roundNumber}</Td><Td>{round.winnerMatchTeamId ?? "-"}</Td><Td>{round.winnerSide ?? "-"}</Td><Td>{round.reason ?? "-"}</Td><Td>{round.bombsite ?? "-"}</Td><Td>{data.kills.find((kill) => kill.roundId === round.id && kill.openingKill)?.weapon ?? "-"}</Td></tr>)}</tbody>
        </Table>
      </section>
      <section className="grid gap-6 lg:grid-cols-3">
        <div><h2 className="mb-3 text-xl font-semibold">Important kills</h2><Table><tbody>{data.kills.slice(0, 15).map((kill) => <tr key={kill.id}><Td>#{kill.sequenceNumber}</Td><Td>{kill.weapon ?? "-"}</Td><Td>{kill.headshot ? "HS" : "-"}</Td></tr>)}</tbody></Table></div>
        <div><h2 className="mb-3 text-xl font-semibold">Bomb events</h2><Table><tbody>{data.bombs.slice(0, 15).map((event) => <tr key={event.id}><Td>#{event.sequenceNumber}</Td><Td>{event.eventType}</Td><Td>{event.site ?? "-"}</Td></tr>)}</tbody></Table></div>
        <div><h2 className="mb-3 text-xl font-semibold">Grenades</h2><Table><tbody>{data.grenades.slice(0, 15).map((event) => <tr key={event.id}><Td>#{event.sequenceNumber}</Td><Td>{event.grenadeType}</Td><Td>{event.demoTime ?? "-"}</Td></tr>)}</tbody></Table></div>
      </section>
    </div>
  );
}
