import { getImports, isImportStatus } from "@/db/queries/imports";
import { importStatus } from "@/db/schema";
import { formatDate, formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Table, Td, Th } from "@/components/table";

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
          {rows.map(({ import: item, match }) => (
            <tr key={item.id}>
              <Td>{item.fileName}</Td>
              <Td><StatusBadge status={item.status} /></Td>
              <Td>{formatDate(item.detectedAt)}</Td>
              <Td>{formatDuration(item.processingStartedAt, item.processingCompletedAt)}</Td>
              <Td>{item.faceitMatchId ?? "-"}</Td>
              <Td>{match?.mapName ?? "-"}</Td>
              <Td>{item.errorMessage ?? "-"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
