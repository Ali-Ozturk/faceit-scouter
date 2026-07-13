const colors: Record<string, string> = {
  COMPLETED: "bg-emerald-100 text-emerald-800",
  DUPLICATE: "bg-sky-100 text-sky-800",
  FAILED: "bg-rose-100 text-rose-800",
  PARSING: "bg-amber-100 text-amber-800",
  PERSISTING: "bg-amber-100 text-amber-800",
  DECOMPRESSING: "bg-amber-100 text-amber-800",
  CLAIMED: "bg-indigo-100 text-indigo-800",
  WAITING_FOR_STABILITY: "bg-slate-100 text-slate-800",
  DISCOVERED: "bg-slate-100 text-slate-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${colors[status] ?? "bg-slate-100 text-slate-800"}`}>{status}</span>;
}
