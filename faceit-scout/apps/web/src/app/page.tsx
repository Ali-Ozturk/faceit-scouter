import Link from "next/link";
import { getDashboard } from "@/db/queries/dashboard";
import { formatDate } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Table, Td, Th } from "@/components/table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboard();
  const stats = [
    ["Total imports", data.stats.totalImports],
    ["Completed", data.stats.completedImports],
    ["Failed", data.stats.failedImports],
    ["Processing", data.stats.activeImports],
    ["Matches", data.stats.matches],
    ["Lineups", data.stats.lineups],
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold">Processing dashboard</h1>
        <p className="mt-2 text-slate-600">Drop `.dem` or `.dem.zst` files into `data/incoming` and watch the pipeline here.</p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-2 text-2xl font-bold">{value}</div>
          </div>
        ))}
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-semibold">Recent imports</h2>
          <Table>
            <thead><tr><Th>File</Th><Th>Status</Th><Th>Detected</Th></tr></thead>
            <tbody>
              {data.recentImports.map((item) => (
                <tr key={item.id}><Td>{item.fileName}</Td><Td><StatusBadge status={item.status} /></Td><Td>{formatDate(item.detectedAt)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 text-xl font-semibold">Recent matches</h2>
          <Table>
            <thead><tr><Th>Map</Th><Th>Score</Th><Th>Opened</Th></tr></thead>
            <tbody>
              {data.recentMatches.map((match) => (
                <tr key={match.id}>
                  <Td>{match.mapName}</Td>
                  <Td>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</Td>
                  <Td><Link className="font-medium text-blue-700" href={`/matches/${match.id}`}>Details</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}
