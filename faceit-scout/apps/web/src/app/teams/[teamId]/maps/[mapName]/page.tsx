import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamMap } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";
import { Table, Td, Th } from "@/components/table";
import { RoundPathPreview } from "@/components/round-path-preview";
import type { PositionSample, PreviewFilterGroup, UtilitySample } from "@/components/round-path-preview";

export const dynamic = "force-dynamic";

const openingTendencyPreviewsEnabled = process.env.OPENING_TENDENCY_PREVIEWS_ENABLED === "true";
const openingWindowSeconds = 30;

export default async function TeamMapPage({ params }: { params: Promise<{ teamId: string; mapName: string }> }) {
  const { teamId, mapName } = await params;
  const data = await getTeamMap(teamId, decodeURIComponent(mapName));
  if (!data) notFound();

  const totalRounds = data.matches.reduce((total, match) => total + match.roundCount, 0);
  const sampledRounds = uniqueRoundCount(data.samples);
  const latestPlayedAt = data.matches[0]?.playedAt ?? null;
  const demoFilterGroups = demoGroupsForMatches(data.matches);

  return (
    <div className="space-y-6">
      <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_560px]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Link href={`/teams/${teamId}`} className="font-medium text-blue-700">Lineup</Link>
            <span className="text-slate-400">/</span>
            <span className="rounded border border-slate-200 bg-white px-2 py-1 font-medium">{data.mapName}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-normal">{data.lineup.displayName}</h1>
          <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
            {data.members.map((member) => (
              <a
                key={member.id}
                href={`#${playerSectionId(member.id)}`}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 hover:border-blue-300 hover:text-blue-700"
              >
                {member.nickname}
              </a>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Matches" value={data.matches.length} />
          <Stat label="Rounds" value={totalRounds} />
          <Stat label="Sampled" value={sampledRounds} />
          <Stat label="Latest" value={formatDate(latestPlayedAt)} />
        </div>
      </header>

      <div className="space-y-5">
          {openingTendencyPreviewsEnabled ? (
            <section id="openings" className="space-y-4">
              <SectionTitle title="Opponent Opening Matrix" detail={`First ${openingWindowSeconds}s from every stored round`} />
              <div className="grid gap-4 xl:grid-cols-2">
                {data.members.map((member) => {
                  const playerSamples = data.samples.filter((sample) => sample.playerId === member.id && sample.seconds <= openingWindowSeconds);
                  const playerUtilities = data.utilities.filter((utility) => utility.throwerPlayerId === member.id);
                  return (
                    <article id={playerSectionId(member.id)} key={member.id} className="scroll-mt-6 rounded border border-slate-200 bg-white p-4 target:animate-[targetPulse_1.8s_ease-in-out_2] target:border-blue-400 target:ring-2 target:ring-blue-200">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{member.nickname}</h3>
                          <p className="text-xs text-slate-500">
                            {uniqueRoundCount(playerSamples)} rounds - {playerUtilities.length} utility events
                          </p>
                        </div>
                        <div className="flex gap-2 text-xs">
                          <SideBadge side="T" count={uniqueRoundCount(playerSamples.filter((sample) => sample.side === "T"))} />
                          <SideBadge side="CT" count={uniqueRoundCount(playerSamples.filter((sample) => sample.side === "CT"))} />
                        </div>
                      </div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <RoundPathPreview
                          title="T openings"
                          mapName={data.mapName}
                          samples={openingSamplesForPlayer(playerSamples, "T", member.id)}
                          utilities={openingUtilitiesForSamples(playerUtilities, playerSamples.filter((sample) => sample.side === "T"))}
                          allowFullscreen
                          maxLegendItems={4}
                        />
                        <RoundPathPreview
                          title="CT openings"
                          mapName={data.mapName}
                          samples={openingSamplesForPlayer(playerSamples, "CT", member.id)}
                          utilities={openingUtilitiesForSamples(playerUtilities, playerSamples.filter((sample) => sample.side === "CT"))}
                          allowFullscreen
                          maxLegendItems={4}
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section id="team-defaults" className="space-y-4">
            <SectionTitle title="Team first round defaults" detail="Only the first T and first CT round from each demo" />
            <div className="grid gap-4 xl:grid-cols-2">
              <RoundPathPreview
                title="T side default"
                mapName={data.mapName}
                samples={mergedSamplesForFirstSideRound(data.samples, data.matches, "T")}
                utilities={utilitiesForSamples(data.utilities, firstSideRoundSamples(data.samples, "T")).map((utility) => ({
                  ...utility,
                  filterGroup: demoGroupId(utility.matchId),
                }))}
                showHeatmap
                density="compact"
                filterGroups={demoFilterGroups}
                maxLegendItems={8}
              />
              <RoundPathPreview
                title="CT side default"
                mapName={data.mapName}
                samples={mergedSamplesForFirstSideRound(data.samples, data.matches, "CT")}
                utilities={utilitiesForSamples(data.utilities, firstSideRoundSamples(data.samples, "CT")).map((utility) => ({
                  ...utility,
                  filterGroup: demoGroupId(utility.matchId),
                }))}
                showHeatmap
                density="compact"
                filterGroups={demoFilterGroups}
                maxLegendItems={8}
              />
            </div>
          </section>

          <section id="match-evidence" className="space-y-3">
            <SectionTitle title="Match Evidence" detail="Open a demo when you need to verify the read" />
            <div className="space-y-2">
              {data.matches.map((match, index) => {
                const matchSamples = data.samples.filter((sample) => sample.matchTeamId === match.matchTeamId);
                const tSamples = matchSamples.filter((sample) => sample.side === "T");
                const ctSamples = matchSamples.filter((sample) => sample.side === "CT");
                return (
                  <details key={`preview-${match.matchTeamId}`} className="rounded border border-slate-200 bg-white">
                    <summary className="grid cursor-pointer gap-2 px-4 py-3 text-sm md:grid-cols-[48px_minmax(0,1fr)_120px_110px_90px] md:items-center">
                      <span className="font-semibold text-slate-500">#{index + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{match.displayName}</span>
                        <span className="text-xs text-slate-500">{formatDate(match.playedAt)} - overlap {match.overlapCount}/5</span>
                      </span>
                      <span>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</span>
                      <span>{match.roundCount} rounds</span>
                      <Link className="font-medium text-blue-700" href={`/matches/${match.matchId}`}>Open</Link>
                    </summary>
                    <div className="grid gap-3 border-t border-slate-100 p-4 lg:grid-cols-2">
                      <RoundPathPreview title="First T round" mapName={data.mapName} samples={tSamples} utilities={utilitiesForSamples(data.utilities, tSamples)} />
                      <RoundPathPreview title="First CT round" mapName={data.mapName} samples={ctSamples} utilities={utilitiesForSamples(data.utilities, ctSamples)} />
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
    </div>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function SideBadge({ side, count }: { side: string; count: number }) {
  return <span className="rounded border border-slate-200 px-2 py-1">{side}: {count}</span>;
}

function utilitiesForSamples(utilities: (UtilitySample & { matchId: string; roundNumber: number | null })[], samples: { matchId?: string; roundNumber?: number }[]): UtilitySample[] {
  const selectedRounds = new Set(samples.filter((sample) => sample.matchId && sample.roundNumber !== undefined).map((sample) => `${sample.matchId}:${sample.roundNumber}`));
  return utilities.filter((utility) => utility.roundNumber !== null && selectedRounds.has(`${utility.matchId}:${utility.roundNumber}`));
}

function mergedSamplesForFirstSideRound(
  samples: PositionSample[],
  matches: { matchTeamId: string }[],
  side: string,
): PositionSample[] {
  return firstSideRoundSamples(samples, side)
    .map((sample) => {
      const matchIndex = matches.findIndex((match) => match.matchTeamId === sample.matchTeamId) + 1;
      return {
        ...sample,
        trackId: `${sample.matchTeamId}-${sample.roundNumber}-${sample.playerName}`,
        colorKey: `${sample.matchTeamId}-${sample.playerName}`,
        filterGroup: demoGroupId(sample.matchId),
        markerLabel: String(matchIndex),
        playerName: sample.playerName,
      };
    });
}

function firstSideRoundSamples(samples: PositionSample[], side: string): PositionSample[] {
  const firstRoundByMatch = new Map<string, number>();
  for (const sample of samples) {
    if (sample.side !== side || !sample.matchId || sample.roundNumber === undefined) continue;
    const current = firstRoundByMatch.get(sample.matchId);
    if (current === undefined || sample.roundNumber < current) firstRoundByMatch.set(sample.matchId, sample.roundNumber);
  }
  return samples.filter((sample) => (
    sample.side === side &&
    sample.matchId !== undefined &&
    sample.roundNumber === firstRoundByMatch.get(sample.matchId)
  ));
}

function openingSamplesForPlayer(samples: PositionSample[], side: string, playerId: string): PositionSample[] {
  return samples
    .filter((sample) => sample.side === side)
    .map((sample) => ({
      ...sample,
      trackId: `${sample.matchId}-${sample.roundNumber}-${playerId}`,
      colorKey: playerId,
      markerLabel: String(sample.roundNumber ?? ""),
      playerName: `Round ${sample.roundNumber}`,
    }));
}

function openingUtilitiesForSamples(utilities: UtilitySample[], samples: PositionSample[]): UtilitySample[] {
  const selectedRounds = new Set(samples.map((sample) => `${sample.matchId}:${sample.roundNumber}`));
  return utilities.filter((utility) => {
    if (utility.roundNumber === null || utility.roundNumber === undefined) return false;
    if (!selectedRounds.has(`${utility.matchId}:${utility.roundNumber}`)) return false;
    const start = utility.flightStartSeconds ?? utility.seconds;
    return start <= openingWindowSeconds;
  });
}

function uniqueRoundCount(samples: { matchId?: string; roundNumber?: number | null }[]) {
  return new Set(samples.filter((sample) => sample.roundNumber !== null && sample.roundNumber !== undefined).map((sample) => `${sample.matchId}:${sample.roundNumber}`)).size;
}

function playerSectionId(playerId: string) {
  return `player-${playerId}`;
}

function demoGroupId(matchId: string | undefined) {
  return `demo-${matchId ?? "unknown"}`;
}

function demoGroupsForMatches(matches: { matchId: string; playedAt: Date | string | null }[]): PreviewFilterGroup[] {
  return matches.map((match, index) => ({
    id: demoGroupId(match.matchId),
    label: String(index + 1),
    detail: formatDate(match.playedAt),
  }));
}
