import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Activity, CalendarDays, Crosshair, ExternalLink, Layers3, Map as MapIcon, Swords, Users } from "lucide-react";
import { getTeamMap } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";
import { GoToTopButton } from "@/components/go-to-top-button";
import { OpeningMatrixNav } from "@/components/opening-matrix-nav";
import { RoundPathPreview } from "@/components/round-path-preview";
import { TeamSecondRoundDefaultTabs } from "@/components/team-second-round-default-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PositionSample, PreviewFilterGroup, UtilitySample } from "@/components/round-path-preview";

export const dynamic = "force-dynamic";

const openingTendencyPreviewsEnabled = process.env.OPENING_TENDENCY_PREVIEWS_ENABLED === "true";
const openingWindowSeconds = 30;
const defaultPositionStartSeconds = 30;
const defaultPositionEndSeconds = 90;

export default async function TeamMapPage({ params }: { params: Promise<{ teamId: string; mapName: string }> }) {
  const { teamId, mapName } = await params;
  const data = await getTeamMap(teamId, decodeURIComponent(mapName));
  if (!data) notFound();

  const totalRounds = data.matches.reduce((total, match) => total + match.roundCount, 0);
  const sampledRounds = uniqueRoundCount(data.samples);
  const latestPlayedAt = data.matches[0]?.playedAt ?? null;
  const demoFilterGroups = demoGroupsForMatches(data.matches);
  const secondRoundDefaultTabs = [
    secondRoundDefaultTab(data.samples, data.utilities, data.matches, data.rounds, true),
    secondRoundDefaultTab(data.samples, data.utilities, data.matches, data.rounds, false),
  ];
  const openingNavItems = data.members.map((member) => {
    const playerSamples = data.samples.filter((sample) => sample.playerId === member.id && sample.seconds <= openingWindowSeconds);
    const playerUtilities = data.utilities.filter((utility) => utility.throwerPlayerId === member.id);
    return {
      id: playerSectionId(member.id),
      nickname: member.nickname,
      rounds: uniqueRoundCount(playerSamples),
      tRounds: uniqueRoundCount(playerSamples.filter((sample) => sample.side === "T")),
      ctRounds: uniqueRoundCount(playerSamples.filter((sample) => sample.side === "CT")),
      utilityEvents: playerUtilities.length,
    };
  });

  return (
    <div className="space-y-6">
      <GoToTopButton />
      <header className="overflow-hidden rounded-lg border bg-white shadow-sm">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_520px]">
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href={`/teams/${teamId}`}>
                  <Users className="h-3.5 w-3.5" />
                  Lineup
                </Link>
              </Button>
              <Badge variant="outline" className="gap-1.5 border-cyan-200 bg-white text-cyan-700">
                <MapIcon className="h-3.5 w-3.5" />
                {data.mapName}
              </Badge>
              <Badge variant="outline" className="gap-1.5 border-amber-200 bg-white text-amber-700">
                <CalendarDays className="h-3.5 w-3.5" />
                Latest {formatDate(latestPlayedAt)}
              </Badge>
            </div>
            <h1 className="max-w-5xl text-2xl font-semibold tracking-normal text-foreground">
              {data.lineup.displayName}
            </h1>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm" className="bg-slate-100 text-slate-800 hover:bg-violet-100 hover:text-violet-800">
                <a href="#team-defaults">
                  <Layers3 className="h-3.5 w-3.5" />
                  Team defaults
                </a>
              </Button>
              {openingTendencyPreviewsEnabled ? (
                <Button asChild variant="secondary" size="sm" className="bg-slate-100 text-slate-800 hover:bg-cyan-100 hover:text-cyan-800">
                  <a href="#openings">
                    <Crosshair className="h-3.5 w-3.5" />
                    Opening matrix
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="secondary" size="sm" className="bg-slate-100 text-slate-800 hover:bg-amber-100 hover:text-amber-900">
                <a href="#match-evidence">
                  <Activity className="h-3.5 w-3.5" />
                  Match evidence
                </a>
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {data.members.map((member) => (
                <a key={member.id} href={`#${playerSectionId(member.id)}`}>
                  <Badge variant="outline" className="bg-white text-slate-700 hover:border-violet-300 hover:text-violet-700">
                    {member.nickname}
                  </Badge>
                </a>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 border-t bg-white p-4 xl:border-l xl:border-t-0">
            <Stat tone="violet" icon={<Layers3 className="h-4 w-4" />} label="Matches" value={data.matches.length} />
            <Stat tone="amber" icon={<Swords className="h-4 w-4" />} label="Rounds" value={totalRounds} />
            <Stat tone="cyan" icon={<Activity className="h-4 w-4" />} label="Samples" value={sampledRounds} />
            <Stat tone="rose" icon={<Users className="h-4 w-4" />} label="Players" value={data.members.length} />
          </div>
        </div>
      </header>

      <div className="space-y-6">
          <section id="team-defaults" className="space-y-4 scroll-mt-24">
            <SectionTitle
              icon={<Layers3 className="h-5 w-5" />}
              title="Team first round defaults"
              detail="Only the first T and first CT round from each demo"
              tone="violet"
            />
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
                allowFullscreen
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
                allowFullscreen
                density="compact"
                filterGroups={demoFilterGroups}
                maxLegendItems={8}
              />
            </div>
          </section>

          <section id="team-second-round-defaults" className="space-y-4 scroll-mt-24">
            <SectionTitle
              icon={<Layers3 className="h-5 w-5" />}
              title="Team second round defaults"
              detail="Second round after this team won or lost the first round on that side"
              tone="violet"
            />
            <TeamSecondRoundDefaultTabs
              mapName={data.mapName}
              tabs={secondRoundDefaultTabs}
              filterGroups={demoFilterGroups}
            />
          </section>

          {openingTendencyPreviewsEnabled ? (
            <section id="openings" className="space-y-4 scroll-mt-24">
              <SectionTitle
                icon={<Crosshair className="h-5 w-5" />}
                title="Opponent Opening Matrix"
                detail={`Path/util: first ${openingWindowSeconds}s. Positions: ${defaultPositionStartSeconds}-${defaultPositionEndSeconds}s defaults.`}
                tone="cyan"
              />
              <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
                <div className="hidden xl:block">
                  <OpeningMatrixNav items={openingNavItems} />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 xl:hidden">
                  {openingNavItems.map((item) => (
                    <a key={item.id} href={`#${item.id}`} className="shrink-0 rounded-md border bg-white px-3 py-2 text-sm font-medium shadow-sm">
                      {item.nickname}
                      <span className="ml-2 text-xs text-amber-700">T: {item.tRounds}</span>
                      <span className="ml-2 text-xs text-cyan-700">CT: {item.ctRounds}</span>
                    </a>
                  ))}
                </div>
                <div className="space-y-4">
                  {data.members.map((member) => {
                    const allPlayerSamples = data.samples.filter((sample) => sample.playerId === member.id);
                    const playerSamples = allPlayerSamples.filter((sample) => sample.seconds <= openingWindowSeconds);
                    const defaultPositionSamples = allPlayerSamples.filter((sample) => sample.seconds >= defaultPositionStartSeconds && sample.seconds <= defaultPositionEndSeconds);
                    const playerUtilities = data.utilities.filter((utility) => utility.throwerPlayerId === member.id);
                    return (
                      <article id={playerSectionId(member.id)} key={member.id} className="scroll-mt-24 rounded-lg border bg-white p-3 shadow-sm target:animate-[targetPulse_1.8s_ease-in-out_2] target:border-cyan-400 target:ring-2 target:ring-cyan-200">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <RoundPathPreview
                            title="T openings"
                            mapName={data.mapName}
                            samples={openingSamplesForPlayer(playerSamples, "T", member.id)}
                            utilities={openingUtilitiesForSamples(playerUtilities, playerSamples.filter((sample) => sample.side === "T")).map((utility) => ({
                              ...utility,
                              filterGroup: demoGroupId(utility.matchId),
                            }))}
                            commonPositionSamples={openingSamplesForPlayer(defaultPositionSamples, "T", member.id)}
                            allowFullscreen
                            showHeatmap
                            heatmapDefaultEnabled={false}
                            showCommonPositions
                            density="compact"
                            filterGroups={demoFilterGroups}
                            maxLegendItems={4}
                          />
                          <RoundPathPreview
                            title="CT openings"
                            mapName={data.mapName}
                            samples={openingSamplesForPlayer(playerSamples, "CT", member.id)}
                            utilities={openingUtilitiesForSamples(playerUtilities, playerSamples.filter((sample) => sample.side === "CT")).map((utility) => ({
                              ...utility,
                              filterGroup: demoGroupId(utility.matchId),
                            }))}
                            commonPositionSamples={openingSamplesForPlayer(defaultPositionSamples, "CT", member.id)}
                            allowFullscreen
                            showHeatmap
                            heatmapDefaultEnabled={false}
                            showCommonPositions
                            density="compact"
                            filterGroups={demoFilterGroups}
                            maxLegendItems={4}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          <section id="match-evidence" className="space-y-3 scroll-mt-24">
            <SectionTitle icon={<Activity className="h-5 w-5" />} title="Match Evidence" detail="Open a demo when you need to verify the read" tone="amber" />
            <div className="space-y-2">
              {data.matches.map((match, index) => {
                const matchSamples = data.samples.filter((sample) => sample.matchTeamId === match.matchTeamId);
                const tSamples = matchSamples.filter((sample) => sample.side === "T");
                const ctSamples = matchSamples.filter((sample) => sample.side === "CT");
                return (
                  <details key={`preview-${match.matchTeamId}`} className="rounded-lg border bg-white/82 shadow-sm shadow-slate-950/5 backdrop-blur">
                    <summary className="grid cursor-pointer gap-2 px-4 py-3 text-sm md:grid-cols-[86px_minmax(0,1fr)_120px_110px_90px] md:items-center">
                      <Badge variant="secondary">Game {index + 1}</Badge>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{match.displayName}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(match.playedAt)} - overlap {match.overlapCount}/5</span>
                      </span>
                      <span>{match.team1Score ?? "-"} : {match.team2Score ?? "-"}</span>
                      <span>{match.roundCount} rounds</span>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/matches/${match.matchId}`}>
                          Open
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </summary>
                    <div className="grid gap-3 border-t p-4 lg:grid-cols-2">
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

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string | number; tone: "violet" | "cyan" | "amber" | "rose" }) {
  const toneClass = {
    violet: "text-violet-600",
    cyan: "text-cyan-600",
    amber: "text-amber-700",
    rose: "text-rose-600",
  }[tone];
  return (
    <div className="border-b border-r p-4 last:border-r-0 even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <span className={toneClass}>{icon}</span>
        {label}
      </div>
      <div className="text-xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function SectionTitle({ icon, title, detail, tone }: { icon: ReactNode; title: string; detail: string; tone: "violet" | "cyan" | "amber" }) {
  const toneClass = {
    violet: "border-violet-200 bg-violet-100 text-violet-700 shadow-violet-500/10",
    cyan: "border-cyan-200 bg-cyan-100 text-cyan-700 shadow-cyan-500/10",
    amber: "border-amber-200 bg-amber-100 text-amber-800 shadow-amber-500/10",
  }[tone];
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-lg border shadow-sm ${toneClass}`}>{icon}</span>
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
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
        colorKey: sample.playerId ?? sample.playerName,
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

type RoundOutcome = {
  matchId: string;
  roundNumber: number;
  winnerMatchTeamId: string | null;
};

function secondRoundDefaultTab(
  samples: PositionSample[],
  utilities: (UtilitySample & { matchId: string; roundNumber: number | null })[],
  matches: { matchId: string; matchTeamId: string }[],
  rounds: RoundOutcome[],
  firstRoundWon: boolean,
) {
  const label = firstRoundWon ? "After round 1 win" : "After round 1 loss";
  const tSamples = mergedSamplesForSecondSideRound(samples, matches, rounds, "T", firstRoundWon);
  const ctSamples = mergedSamplesForSecondSideRound(samples, matches, rounds, "CT", firstRoundWon);
  return {
    id: firstRoundWon ? "after-win" : "after-loss",
    label,
    detail: `${uniqueRoundCount([...tSamples, ...ctSamples])} rounds`,
    tSamples,
    ctSamples,
    tUtilities: utilitiesForSamples(utilities, tSamples).map((utility) => ({
      ...utility,
      filterGroup: demoGroupId(utility.matchId),
    })),
    ctUtilities: utilitiesForSamples(utilities, ctSamples).map((utility) => ({
      ...utility,
      filterGroup: demoGroupId(utility.matchId),
    })),
  };
}

function mergedSamplesForSecondSideRound(
  samples: PositionSample[],
  matches: { matchId: string; matchTeamId: string }[],
  rounds: RoundOutcome[],
  side: string,
  firstRoundWon: boolean,
): PositionSample[] {
  const targetRounds = secondSideRoundNumbers(samples, matches, rounds, side, firstRoundWon);
  return samples
    .filter((sample) => (
      sample.side === side &&
      sample.matchId !== undefined &&
      sample.roundNumber === targetRounds.get(sample.matchId)
    ))
    .map((sample) => {
      const matchIndex = matches.findIndex((match) => match.matchTeamId === sample.matchTeamId) + 1;
      return {
        ...sample,
        trackId: `${sample.matchTeamId}-${sample.roundNumber}-${sample.playerName}`,
        colorKey: sample.playerId ?? sample.playerName,
        filterGroup: demoGroupId(sample.matchId),
        markerLabel: String(matchIndex),
        playerName: sample.playerName,
      };
    });
}

function secondSideRoundNumbers(
  samples: PositionSample[],
  matches: { matchId: string; matchTeamId: string }[],
  rounds: RoundOutcome[],
  side: string,
  firstRoundWon: boolean,
) {
  const firstRoundByMatch = new Map<string, number>();
  for (const sample of samples) {
    if (sample.side !== side || !sample.matchId || sample.roundNumber === undefined) continue;
    const current = firstRoundByMatch.get(sample.matchId);
    if (current === undefined || sample.roundNumber < current) firstRoundByMatch.set(sample.matchId, sample.roundNumber);
  }

  const roundsByMatchAndNumber = new Map(rounds.map((roundOutcome) => [`${roundOutcome.matchId}:${roundOutcome.roundNumber}`, roundOutcome]));
  const matchTeamByMatch = new Map(matches.map((match) => [match.matchId, match.matchTeamId]));
  const targetRounds = new Map<string, number>();
  for (const [matchId, firstRoundNumber] of firstRoundByMatch.entries()) {
    const firstRound = roundsByMatchAndNumber.get(`${matchId}:${firstRoundNumber}`);
    const matchTeamId = matchTeamByMatch.get(matchId);
    if (!firstRound || !matchTeamId) continue;
    const teamWonFirstRound = firstRound.winnerMatchTeamId === matchTeamId;
    if (teamWonFirstRound === firstRoundWon) targetRounds.set(matchId, firstRoundNumber + 1);
  }
  return targetRounds;
}

function openingSamplesForPlayer(samples: PositionSample[], side: string, playerId: string): PositionSample[] {
  return samples
    .filter((sample) => sample.side === side)
    .map((sample) => ({
      ...sample,
      trackId: `${sample.matchId}-${sample.roundNumber}-${playerId}`,
      colorKey: playerId,
      filterGroup: demoGroupId(sample.matchId),
      positionGroupKey: playerId,
      positionGroupLabel: sample.playerName,
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
    label: `Game ${index + 1}`,
    detail: formatDate(match.playedAt),
  }));
}
