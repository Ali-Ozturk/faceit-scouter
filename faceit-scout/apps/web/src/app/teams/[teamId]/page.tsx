import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeam } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";
import { Table, Td, Th } from "@/components/table";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params;
  const team = await getTeam(teamId);
  if (!team) notFound();
  const maps = new Map<string, number>();
  team.matches.forEach((match) => maps.set(match.mapName, (maps.get(match.mapName) ?? 0) + 1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{team.lineup.displayName}</h1>
        <p className="mt-2 text-slate-600">{team.members.map((member) => member.nickname).join(", ")}</p>
      </div>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Maps</h2>
        <div className="flex flex-wrap gap-2">
          {[...maps.entries()].map(([mapName, count]) => (
            <Link key={mapName} href={`/teams/${teamId}/maps/${encodeURIComponent(mapName)}`} className="rounded border bg-white px-3 py-2 text-sm">{mapName} · {count}</Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Matches</h2>
        <Table>
          <thead><tr><Th>Map</Th><Th>Date</Th><Th>Score</Th><Th>Rounds</Th><Th></Th></tr></thead>
          <tbody>
            {team.matches.map((match) => (
              <tr key={match.matchId}>
                <Td>{match.mapName}</Td><Td>{formatDate(match.playedAt)}</Td><Td>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</Td><Td>{match.roundCount}</Td>
                <Td><Link className="text-blue-700" href={`/matches/${match.matchId}`}>Open</Link></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
