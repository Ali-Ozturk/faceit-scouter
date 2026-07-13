import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamMap } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";
import { Table, Td, Th } from "@/components/table";

export const dynamic = "force-dynamic";

export default async function TeamMapPage({ params }: { params: Promise<{ teamId: string; mapName: string }> }) {
  const { teamId, mapName } = await params;
  const data = await getTeamMap(teamId, decodeURIComponent(mapName));
  if (!data) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{data.lineup.displayName} on {data.mapName}</h1>
        <p className="mt-2 text-slate-600">{data.matches.length} processed matches for this exact lineup and map.</p>
      </div>
      <Table>
        <thead><tr><Th>Date</Th><Th>Score</Th><Th>Starting side</Th><Th>Rounds</Th><Th></Th></tr></thead>
        <tbody>
          {data.matches.map((match) => (
            <tr key={match.matchId}>
              <Td>{formatDate(match.playedAt)}</Td><Td>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</Td><Td>{match.startingSide ?? "-"}</Td><Td>{match.roundCount}</Td>
              <Td><Link className="text-blue-700" href={`/matches/${match.matchId}`}>Open</Link></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <section className="rounded border border-dashed border-slate-300 bg-white p-5">
        <h2 className="font-semibold">Future tactical analysis</h2>
        <p className="mt-2 text-sm text-slate-600">Utility patterns, opening defaults, site tendencies, and anti-strat summaries will land here after the ingestion pipeline is proven.</p>
      </section>
    </div>
  );
}
