import type { ImportStageLog } from "@/db/queries/imports";
import { formatDate } from "@/lib/format";

type ImportStageLogsProps = {
  logs: ImportStageLog[];
};

type ImportStageSummaryProps = {
  logs: ImportStageLog[];
};

export function ImportStageSummary({ logs }: ImportStageSummaryProps) {
  const total = [...logs].reverse().find((log) => log.stage === "total");

  return (
    <span className="text-xs text-slate-500">
      {logs.length ? `${logs.length} stages` : "No logs"}
      {total ? <span className="ml-1">/ {formatMilliseconds(total.durationMs)}</span> : null}
    </span>
  );
}

export function ImportStageLogs({ logs }: ImportStageLogsProps) {
  return (
    <div className="overflow-auto rounded border border-slate-200 bg-slate-50 p-2">
      {logs.length ? (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="px-2 py-1 font-semibold">Stage</th>
              <th className="px-2 py-1 font-semibold">Time</th>
              <th className="px-2 py-1 font-semibold">Source</th>
              <th className="px-2 py-1 font-semibold">When</th>
              <th className="px-2 py-1 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-slate-200">
                <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-800">{humanizeStage(log.stage)}</td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{formatMilliseconds(log.durationMs)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {log.source}
                  {log.worker ? <span className="text-slate-400"> / {log.worker}</span> : null}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-500">{formatDate(log.createdAt)}</td>
                <td className="px-2 py-1 text-slate-600">{formatMetadata(log.metadataJson)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-2 py-3 text-xs text-slate-500">No stage logs recorded for this import yet.</div>
      )}
    </div>
  );
}

function formatMilliseconds(value: number) {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

function humanizeStage(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "-";
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined);
  if (entries.length === 0) return "-";
  return entries.map(([key, entryValue]) => `${humanizeStage(key)}: ${String(entryValue)}`).join(", ");
}
