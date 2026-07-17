"use client";

import { FormEvent, useState } from "react";

type AnalysisResponse = {
  analysisId: string;
  opponents: { faceitPlayerId: string; nickname: string }[];
  candidates: {
    faceitMatchId: string;
    map: string | null;
    sharedPlayerCount: number;
    playedAt: string | null;
    faceitMatchroomUrl: string;
    processed: boolean;
    processedMatchId: string | null;
  }[];
  warnings?: string[];
};

export function AnalysisForm() {
  const [faceitMatchId, setFaceitMatchId] = useState("");
  const [requestingPlayerFaceitId, setRequestingPlayerFaceitId] = useState("");
  const [selectedMap, setSelectedMap] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setAnalysis(null);

    const response = await fetch("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        faceitMatchId,
        requestingPlayerFaceitId,
        selectedMap: selectedMap || undefined,
      }),
    });
    const body = await response.json();
    setIsLoading(false);

    if (!response.ok) {
      setError(body.error ?? "Could not create analysis.");
      return;
    }

    setAnalysis(body);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="grid gap-4 rounded border border-slate-200 bg-white p-5 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Current lobby or match ID</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={faceitMatchId}
            onChange={(event) => setFaceitMatchId(event.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Your FACEIT player ID or nickname</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={requestingPlayerFaceitId}
            onChange={(event) => setRequestingPlayerFaceitId(event.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Map</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="de_inferno"
            value={selectedMap}
            onChange={(event) => setSelectedMap(event.target.value)}
          />
        </label>
        <div className="md:col-span-3">
          <button
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? "Finding matches..." : "Start analysis"}
          </button>
        </div>
      </form>

      {error ? <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      {analysis ? (
        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold">Opposing players</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {analysis.opponents.map((opponent) => (
                <div key={opponent.faceitPlayerId} className="rounded border border-slate-200 bg-white p-3">
                  <div className="font-medium">{opponent.nickname}</div>
                  <div className="mt-1 break-all text-xs text-slate-500">{opponent.faceitPlayerId}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold">Historical matches</h2>
            <p className="mt-2 text-sm text-slate-600">
              Open a FACEIT matchroom, download the demo manually, then place the `.dem` or `.dem.zst` file in `data/incoming`.
            </p>
            <div className="mt-3 overflow-hidden rounded border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Match</th>
                    <th className="px-4 py-3">Map</th>
                    <th className="px-4 py-3">Shared</th>
                    <th className="px-4 py-3">Played</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.candidates.map((candidate) => (
                    <tr key={candidate.faceitMatchId} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        <a className="font-medium text-blue-700" href={candidate.faceitMatchroomUrl} target="_blank" rel="noreferrer">
                          Open matchroom
                        </a>
                        <div className="mt-1 break-all text-xs text-slate-500">{candidate.faceitMatchId}</div>
                      </td>
                      <td className="px-4 py-3">{candidate.map ?? "-"}</td>
                      <td className="px-4 py-3">{candidate.sharedPlayerCount}</td>
                      <td className="px-4 py-3">{candidate.playedAt ? new Date(candidate.playedAt).toLocaleString() : "-"}</td>
                      <td className="px-4 py-3">
                        <span className={candidate.processed ? "font-medium text-emerald-700" : "text-slate-500"}>
                          {candidate.processed ? "Processed" : "Not processed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {analysis.candidates.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>No qualifying matches found.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {analysis.warnings?.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {analysis.warnings.join(" ")}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
