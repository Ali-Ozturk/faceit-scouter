import Link from "next/link";
import type { ReactNode } from "react";
import { getDashboard } from "@/db/queries/dashboard";
import { formatDate } from "@/lib/format";
import { ImportStageLogs, ImportStageSummary } from "@/components/import-stage-logs";
import { StatusBadge } from "@/components/status-badge";
import { Table, Td, Th } from "@/components/table";
import { AutoRefresh } from "@/components/auto-refresh";

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
      <AutoRefresh enabled={data.stats.activeImports > 0} />
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
              {data.recentImports.map(({ import: item, stageLogs }) => (
                <ImportLogRows
                  key={item.id}
                  colSpan={3}
                  summary={(
                    <>
                      <div className="min-w-0">
                        <span className="font-medium">{item.fileName}</span>
                        <div className="mt-1"><ImportStageSummary logs={stageLogs} /></div>
                      </div>
                      <div><StatusBadge status={item.status} /></div>
                      <div className="whitespace-nowrap text-slate-600">{formatDate(item.detectedAt)}</div>
                    </>
                  )}
                  logs={<ImportStageLogs logs={stageLogs} />}
                />
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="mb-3 text-xl font-semibold">Latest lineups</h2>
          <Table>
            <thead><tr><Th>Lineup</Th><Th>Matches</Th><Th>Last identified</Th></tr></thead>
            <tbody>
              {data.latestLineups.map((lineup) => (
                <tr key={lineup.id}>
                  <Td>
                    <Link className="font-medium text-blue-700" href={`/teams/${lineup.id}`}>{lineup.displayName}</Link>
                    <div className="mt-1 text-xs text-slate-500">{lineup.exactLineupCount} variants | {lineup.maps ?? "No maps yet"}</div>
                  </Td>
                  <Td>{lineup.matchCount}</Td>
                  <Td>{formatDate(lineup.lastProcessedAt)}</Td>
                </tr>
              ))}
              {data.latestLineups.length === 0 ? (
                <tr><td colSpan={3} className="border-b border-slate-100 px-4 py-6 text-center text-slate-500">No lineups identified yet.</td></tr>
              ) : null}
            </tbody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function ImportLogRows({ summary, logs, colSpan }: { summary: ReactNode; logs: ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-slate-100 p-0">
        <details className="group">
          <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
            {summary}
          </summary>
          <div className="border-t border-slate-100 bg-white p-3">
            {logs}
          </div>
        </details>
      </td>
    </tr>
  );
}
