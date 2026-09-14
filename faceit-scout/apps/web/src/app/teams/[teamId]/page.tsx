import { MapLink } from "@/components/map-link";
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
        <p className="mb-4 text-sm text-slate-600">Choose a map to explore this team's analyzed matches and tendencies.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
          {[...maps.entries()].map(([mapName, count]) => (
            <MapLink
              key={mapName}
              href={`/teams/${teamId}/maps/${encodeURIComponent(mapName)}`}
              mapName={mapName}
              count={count}
            />
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Matches analyzed</h2>
        <Table>
          <thead><tr><Th>Map</Th><Th>Date</Th><Th>Score</Th><Th>Rounds</Th></tr></thead>
          <tbody>
            {team.matches.map((match) => (
              <tr key={match.matchId}>
                <Td>{match.mapName}</Td><Td>{formatDate(match.playedAt)}</Td><Td>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</Td><Td>{match.roundCount}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
