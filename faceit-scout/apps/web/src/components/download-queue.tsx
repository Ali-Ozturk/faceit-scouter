"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function DownloadQueue({ jobs }: { jobs: Array<{ id: string; faceitMatchId: string; status: string; error: string | null }> }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return <section className="rounded border bg-white p-4">
    <h2 className="font-semibold">Extension imports · 3 shared slots</h2>
    <p className="my-2 text-sm text-slate-600">The backend downloads and parses each demo. Successful demo files are deleted; match results remain available.</p>
    {!jobs.length && <p className="text-sm">No URL imports yet. Submit demos from the extension.</p>}
    {jobs.map(job => <div className="border-t py-2 text-sm" key={job.id}>
      <span className="font-medium">{job.status}</span> · {job.faceitMatchId}
      {job.error && <p className="text-red-700">{job.error}</p>}
    </div>)}
  </section>;
}
