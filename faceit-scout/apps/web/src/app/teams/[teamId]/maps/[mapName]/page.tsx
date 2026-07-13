import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamMap } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";
import { Table, Td, Th } from "@/components/table";
import { RoundPathPreview } from "@/components/round-path-preview";

export const dynamic = "force-dynamic";

export default async function TeamMapPage({ params }: { params: Promise<{ teamId: string; mapName: string }> }) {
  const { teamId, mapName } = await params;
  const data = await getTeamMap(teamId, decodeURIComponent(mapName));
  if (!data) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{data.lineup.displayName} on {data.mapName}</h1>
        <p className="mt-2 text-slate-600">{data.matches.length} processed matches with at least 4 shared players on this map.</p>
      </div>
      <section className="space-y-5">
        <h2 className="text-xl font-semibold">First-round previews</h2>
        {data.matches.map((match) => {
          const matchSamples = data.samples.filter((sample) => sample.matchTeamId === match.matchTeamId);
          const tSamples = matchSamples.filter((sample) => sample.side === "T");
          const ctSamples = matchSamples.filter((sample) => sample.side === "CT");
          return (
            <div key={`preview-${match.matchTeamId}`} className="space-y-3 rounded border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{match.displayName}</h3>
                  <p className="text-sm text-slate-600">{formatDate(match.playedAt)} · score {match.teamScore ?? "-"} · overlap {match.overlapCount}/5</p>
                </div>
                <a className="text-sm font-medium text-blue-700" href={`/matches/${match.matchId}`}>Open match</a>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <RoundPathPreview title="First T round" mapName={data.mapName} samples={tSamples} />
                <RoundPathPreview title="First CT round" mapName={data.mapName} samples={ctSamples} />
              </div>
            </div>
          );
        })}
      </section>
      <Table>
        <thead><tr><Th>Date</Th><Th>Score</Th><Th>Starting side</Th><Th>Overlap</Th><Th>Rounds</Th><Th></Th></tr></thead>
        <tbody>
          {data.matches.map((match) => (
            <tr key={match.matchTeamId}>
              <Td>{formatDate(match.playedAt)}</Td><Td>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</Td><Td>{match.startingSide ?? "-"}</Td><Td>{match.overlapCount}/5</Td><Td>{match.roundCount}</Td>
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
