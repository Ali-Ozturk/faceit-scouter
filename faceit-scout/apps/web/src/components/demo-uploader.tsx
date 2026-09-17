"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { retryUploadRequest, sendChunkWithRecovery, UploadRequestError } from "@/lib/resumable-upload";

import { uploadTwoAtATime } from "@/lib/upload-pool";

type Job = { id: string; faceitMatchId: string; status: string; mapName?: string | null; matchPlayedAt?: string | null };
type Choice = { file: File; jobId: string; progress: number; message: string };
const CHUNK = 4 * 1024 * 1024;
const IMPORT_KEY_STORAGE = "faceitScout.importAccessKey";
const waiting = (job: Job) => ["AWAITING_UPLOAD", "UPLOADING", "WAITING_FOR_BATCH"].includes(job.status);

export function DemoUploader() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [message, setMessage] = useState("Enter the same import access key as your extension to load pending matches.");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [storageMessage, setStorageMessage] = useState("");
  const stop = useRef(false);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const remembered = localStorage.getItem(IMPORT_KEY_STORAGE);
      if (remembered) {
        setKey(remembered);
        setSaved(true);
        void load(remembered);
      }
    } catch { setStorageMessage("Browser storage is unavailable. You can still enter the key for this visit."); }
  }, []);
  async function api(url: string, options: RequestInit = {}, accessKey = key.trim()) {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessKey}` }, redirect: "error", signal: AbortSignal.timeout(120000) });
    const body = await response.json().catch(() => {
      throw new UploadRequestError(`Upload server returned an incomplete response (HTTP ${response.status}).`, response.ok ? 503 : response.status);
    });
    if (response.status === 401) {
      try {
        if (localStorage.getItem(IMPORT_KEY_STORAGE) === accessKey) {
          localStorage.removeItem(IMPORT_KEY_STORAGE);
          setSaved(false);
        }
      } catch { /* The current request still reports its authentication failure. */ }
    }
    if (!response.ok) throw new UploadRequestError(body.error ?? "Upload request failed.", response.status);
    return body;
  }
  async function load(accessKey = key.trim()) {
    setLoading(true);
    try {
      const body = await api("/api/demo-uploads", {}, accessKey);
      const pending = (body.jobs as Job[]).filter(waiting);
      const selected = new Set(new URLSearchParams(window.location.search).get("uploads")?.split(",") ?? []);
      pending.sort((a,b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));
      setJobs(pending);
      try {
        localStorage.setItem(IMPORT_KEY_STORAGE, accessKey);
        setSaved(true);
        setStorageMessage("");
      } catch { setStorageMessage("The key works, but this browser could not save it for next time."); }
      setMessage(pending.length ? "Download demos using FACEIT’s Watch Demo button, then select or drop up to three files here." : "No pending uploads. Select matches in the extension and click Open matches.");
    } catch (e) { setMessage(errorText(e)); }
    finally { setLoading(false); }
  }
  function forgetKey() {
    try { localStorage.removeItem(IMPORT_KEY_STORAGE); }
    catch { setStorageMessage("Could not remove the saved key. Clear this site's browser data to forget it."); return; }
    setSaved(false); setKey(""); setJobs([]); setChoices([]); setStorageMessage("");
    setMessage("Saved key forgotten. Enter an import access key to load pending matches.");
  }
  function select(files: FileList | null) {
    if (!files || busy) return;
    if (files.length > 3) { setMessage("Choose at most three demos at a time."); return; }
    const next = Array.from(files).map(file => {
      const id = file.name.match(/1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0].toLowerCase();
      return { file, jobId: jobs.find(j => j.faceitMatchId === id)?.id ?? "", progress: 0, message: "Confirm the matching historical match below." };
    });
    setChoices(next);
  }
  function patch(index: number, update: Partial<Choice>) {
    setChoices(current => current.map((c,i) => i === index ? { ...c, ...update } : c));
  }
  async function upload() {
    if (!choices.length || choices.some(c => !c.jobId) || new Set(choices.map(c => c.jobId)).size !== choices.length) {
      setMessage("Assign each file to a different selected match."); return;
    }
    stop.current = false; setBusy(true);
    setMessage("Uploading up to two demos at a time. Processing waits for pending uploads. Keep this page open during transfer.");
    try {
      await uploadTwoAtATime(choices, async ({ file, jobId }, index) => {
        if (stop.current) { patch(index, { message: "Paused. Click Upload / resume to continue." }); return; }
        try {
          patch(index, { message: "Preparing upload…" });
          if (!/\.dem(?:\.zst|\.gz)?$/i.test(file.name) || file.size < 8 || file.size > 2_000_000_000) throw new Error("Choose a demo file smaller than 2 GB.");
          // Bounded identity sample prevents accidentally resuming a different local file.
          const sample = await new Blob([file.slice(0,65536), file.slice(Math.max(0,file.size-65536))]).arrayBuffer();
          const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", sample))).map(b => b.toString(16).padStart(2,"0")).join("");
          const state = await retryUploadRequest({ request: () => api(`/api/demo-uploads/${jobId}`), shouldStop: () => stop.current,
            onRetry: attempt => patch(index, { message: `VPS temporarily unavailable. Retrying connection (${attempt})…` }),
          });
          if (["WAITING_FOR_BATCH", "QUEUED", "PROCESSING", "COMPLETED"].includes(state.status)) { patch(index, { progress: 100, message: state.status === "WAITING_FOR_BATCH" ? "Received. Waiting for the other selected demos." : "Already received by server." }); return; }
          if (!["AWAITING_UPLOAD", "UPLOADING"].includes(state.status)) throw new Error("This upload was cancelled or failed. Open the match again in the extension.");
          let offset = state.offset as number;
          if (!Number.isSafeInteger(offset) || offset < 0 || offset >= file.size) throw new Error("Upload server returned an invalid resume offset.");
          patch(index, { progress: Math.round(offset/file.size*100), message: "Uploading..." });
          while (offset < file.size && !stop.current) {
            const end = Math.min(offset + CHUNK, file.size);
            const chunkOffset = offset;
            const result = await sendChunkWithRecovery({ offset: chunkOffset, end, shouldStop: () => stop.current,
              send: () => api(`/api/demo-uploads/${jobId}`, { method: "PUT", body: file.slice(chunkOffset,end), headers: {
                "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name),
                "X-File-Size": String(file.size), "X-File-Fingerprint": fingerprint, "X-Upload-Offset": String(chunkOffset),
              } }),
              inspect: () => api(`/api/demo-uploads/${jobId}`),
              onRetry: attempt => patch(index, { message: `VPS temporarily unavailable. Retrying chunk (${attempt})…` }),
            });
            const nextOffset = result.complete ? file.size : result.offset;
            if (!Number.isSafeInteger(nextOffset) || nextOffset! <= chunkOffset || nextOffset! > file.size) throw new Error("Upload server returned an invalid resume offset.");
            offset = nextOffset!;
            patch(index, { progress: Math.round(offset/file.size*100), message: offset === file.size ? (result.status === "WAITING_FOR_BATCH" ? "Received. Waiting for the other selected demos." : "Received. Queued for processing.") : "Uploading…" });
          }
          if (stop.current && offset < file.size) patch(index, { message: "Paused. Click Upload / resume to continue." });
        } catch (e) { patch(index, { message: errorText(e) + " Click Upload / resume to retry with this file." }); }
      });
      router.refresh();
      setMessage(stop.current ? "Uploads stopped after their current chunks. Completed files stay staged until the remaining uploads finish or are cancelled." : "Transfers stopped. Check each file’s status below; completed files process after the remaining reservations finish or are cancelled.");
    } finally { setBusy(false); }
  }
  async function cancel(job: Job) {
    try {
      await api(`/api/demo-uploads/${job.id}`, { method: "DELETE" });
      setJobs(current => current.filter(j => j.id !== job.id));
      setChoices(current => current.filter(c => c.jobId !== job.id));
      router.refresh();
    } catch (e) { setMessage(errorText(e)); }
  }
  return <section className="space-y-3 rounded border bg-white p-4" aria-label="Upload manually downloaded demos">
    <h2 className="text-lg font-semibold">Upload your demos</h2>
    <p className="text-sm text-slate-600">Download on FACEIT, then select up to three compressed files here. Files upload two at a time, with automatic retries during temporary outages. Keep this page open during transfer. Interrupted uploads resume when you select the same files again.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-sm">Import access key<input className="ml-2 rounded border p-2" type="password" autoComplete="off" value={key} disabled={busy || loading} onChange={e => { setKey(e.target.value); setJobs([]); setChoices([]); }} /></label>
      <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || loading || key.trim().length < 24} onClick={() => void load()}>{loading ? "Loading…" : "Load pending matches"}</button>
      {saved && <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || loading} onClick={forgetKey}>Forget saved key</button>}
    </div>
    <p className="text-xs text-slate-500">{storageMessage || (saved ? "Key saved in this browser for this Scout site." : "Your key is saved in this browser after a successful connection.")}</p>
    <p role="status" className="text-sm">{message}</p>
    {!!jobs.length && <>
      <div className="rounded border-2 border-dashed p-5" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); select(e.dataTransfer.files); }}>
        <label>Drop demos here or choose files <input type="file" multiple accept=".dem,.zst,.gz" disabled={busy} onChange={e => select(e.target.files)} /></label>
      </div>
      {choices.map((choice,index) => <div key={index} className="space-y-2 rounded border p-3">
        <p className="break-all font-medium">{choice.file.name}</p>
        <label className="text-sm">Match <select className="max-w-full rounded border p-2" aria-label={`Match for ${choice.file.name}`} value={choice.jobId} disabled={busy} onChange={e => patch(index,{ jobId:e.target.value })}>
          <option value="">Choose the matching match…</option>
          {jobs.map(job => <option value={job.id} key={job.id}>{job.mapName ?? "Unknown map"} · {job.matchPlayedAt ? new Date(job.matchPlayedAt).toLocaleString() : "Unknown date"} · {job.faceitMatchId}</option>)}
        </select></label>
        <progress className="w-full" value={choice.progress} max={100} aria-label={`Upload progress for ${choice.file.name}`} />
        <p className="text-sm" role="status">{choice.progress}% · {choice.message}</p>
      </div>)}
      <button className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy || !choices.length} onClick={() => void upload()}>Upload / resume</button>
      {busy && <button className="ml-3 rounded border px-3 py-2" onClick={() => { stop.current = true; }}>Pause uploads</button>}
      <details><summary className="cursor-pointer text-sm">Pending matches · cancel unused uploads to free queue slots</summary>
        {jobs.map(job => <div className="flex flex-wrap items-center gap-3 py-2 text-sm" key={job.id}>
          <a href={`https://www.faceit.com/en/cs2/room/${job.faceitMatchId}`} target="_blank" rel="noreferrer">{job.mapName ?? "Match"} · {job.faceitMatchId} ↗</a>
          <button className="rounded border p-1" disabled={busy} onClick={() => void cancel(job)}>Cancel upload</button>
        </div>)}
      </details>
    </>}
  </section>;
}
function errorText(e: unknown) { return e instanceof Error ? e.message : "Upload failed."; }
