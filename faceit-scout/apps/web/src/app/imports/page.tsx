import type { ReactNode } from "react";
import { getImports, isImportStatus } from "@/db/queries/imports";
import { importStatus } from "@/db/schema";
import { formatDate, formatDuration } from "@/lib/format";
import { ImportStageLogs, ImportStageSummary } from "@/components/import-stage-logs";
import { StatusBadge } from "@/components/status-badge";
import { Table, Th } from "@/components/table";

export const dynamic = "force-dynamic";
export const revalidate = 3;

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const status = params.status && isImportStatus(params.status) ? params.status : undefined;
  const rows = await getImports(status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Imports</h1>
        <p className="mt-2 text-slate-600">Current and historical demo processing states.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className="rounded border bg-white px-3 py-2 text-sm" href="/imports">All</a>
        {importStatus.enumValues.map((value) => <a key={value} className="rounded border bg-white px-3 py-2 text-sm" href={`/imports?status=${value}`}>{value}</a>)}
      </div>
      <Table>
        <thead><tr><Th>File</Th><Th>Status</Th><Th>Detected</Th><Th>Duration</Th><Th>FACEIT ID</Th><Th>Map</Th><Th>Error</Th></tr></thead>
        <tbody>
          {rows.map(({ import: item, match, stageLogs }) => (
            <ImportLogRows
              key={item.id}
              colSpan={7}
              summary={(
                <>
                  <div className="min-w-0">
                    <span className="font-medium">{item.fileName}</span>
                    <div className="mt-1"><ImportStageSummary logs={stageLogs} /></div>
                  </div>
                  <div><StatusBadge status={item.status} /></div>
                  <div className="whitespace-nowrap text-slate-600">{formatDate(item.detectedAt)}</div>
                  <div className="whitespace-nowrap">{formatDuration(item.processingStartedAt, item.processingCompletedAt)}</div>
                  <div className="truncate">{item.faceitMatchId ?? "-"}</div>
                  <div className="whitespace-nowrap">{match?.mapName ?? "-"}</div>
                  <div className="truncate text-slate-600">{item.errorMessage ?? "-"}</div>
                </>
              )}
              logs={<ImportStageLogs logs={stageLogs} />}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function ImportLogRows({ summary, logs, colSpan }: { summary: ReactNode; logs: ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-slate-100 p-0">
        <details className="group">
          <summary className="grid cursor-pointer list-none grid-cols-[minmax(220px,1.7fr)_120px_160px_90px_minmax(130px,1fr)_90px_minmax(160px,1.2fr)] items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
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
