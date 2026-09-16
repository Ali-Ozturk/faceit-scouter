"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
type Job = {
  id: string; status: string; error: string | null; importStatus: string | null;
  createdAt: Date | string; matchPlayedAt: Date | string | null;
  requesterNickname: string | null; mapName: string | null;
};
const labels: Record<string, string> = {
  AWAITING_UPLOAD: "Awaiting upload", UPLOADING: "Uploading demo",
  QUEUED: "Waiting for a worker", DOWNLOADING: "Downloading demo", PROCESSING: "Preparing demo",
  DISCOVERED: "Demo received", WAITING_FOR_STABILITY: "Checking download", CLAIMED: "Preparing demo",
  DECOMPRESSING: "Decompressing demo", PARSING: "Parsing match", PERSISTING: "Saving match results",
  COMPLETED: "Ready to analyze", DUPLICATE: "Already imported", FAILED: "Import failed",
};
export function DownloadQueue({ jobs }: { jobs: Job[] }) {
  const router = useRouter();
  const [localTime, setLocalTime] = useState(false);
  useEffect(() => {
    setLocalTime(true);
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  function date(value: Date | string | null) {
    if (!value) return "Not recorded";
    const parsed = new Date(value);
    return localTime ? parsed.toLocaleString() : parsed.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
  return <section className="rounded border bg-white p-4">
    <h2 className="font-semibold">Extension imports · Latest 6</h2>
    <p className="my-2 text-sm text-slate-600">Up to 9 pending imports. Each completed upload enters the processing queue immediately. Completed demo files are deleted; match results remain available.</p>
    {!jobs.length && <p className="text-sm">No imports yet. Submit demos from the extension.</p>}
    {jobs.map(job => {
      const stage = job.status === "PROCESSING" ? job.importStatus ?? job.status : job.status;
      const color = job.status === "FAILED" ? "bg-red-500" : job.status === "COMPLETED" ? "bg-green-500" : job.status === "QUEUED" ? "bg-blue-500" : "bg-orange-500";
      return <article className="relative border-t py-3 pl-7 text-sm" key={job.id}>
        <span className={`absolute left-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ${color}`} aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{job.mapName ?? "Demo"} · {job.requesterNickname ?? "Player not recorded"}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${job.status === "FAILED" ? "bg-red-100 text-red-800" : job.status === "COMPLETED" ? "bg-green-100 text-green-800" : job.status === "QUEUED" ? "bg-blue-100 text-blue-800" : "bg-orange-100 text-orange-800"}`}>{labels[stage] ?? stage}</span>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-slate-600">
          <div><dt className="inline font-medium">Requested: </dt><dd className="inline">{date(job.createdAt)}</dd></div>
          <div><dt className="inline font-medium">Match played: </dt><dd className="inline">{date(job.matchPlayedAt)}</dd></div>
        </dl>
        {job.error && <p className="mt-2 rounded bg-red-50 p-2 text-red-700">{job.error}</p>}
      </article>;
    })}
  </section>;
}
