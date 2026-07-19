"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

export type PositionSample = {
  trackId?: string;
  colorKey?: string;
  markerLabel?: string;
  filterGroup?: string;
  positionGroupKey?: string;
  positionGroupLabel?: string;
  playerId?: string;
  matchId?: string;
  matchTeamId?: string;
  roundNumber?: number;
  side: string;
  seconds: number;
  playerName: string;
  x: number;
  y: number;
  tick?: number;
  alive: boolean | null;
};

export type UtilitySample = {
  id: string;
  filterGroup?: string;
  matchId?: string;
  throwerPlayerId?: string | null;
  throwerTeamId?: string | null;
  roundNumber?: number | null;
  grenadeType: string;
  flightStartSeconds?: number | null;
  seconds: number;
  durationSeconds?: number | null;
  startX?: number | null;
  startY?: number | null;
  endX?: number | null;
  endY?: number | null;
  throwerName?: string | null;
};

type RadarConfig = {
  imageUrl?: string;
  imageSize: number;
  posX?: number;
  posY?: number;
  scale?: number;
};

export type PreviewFilterGroup = {
  id: string;
  label: string;
  detail?: string;
};

type TopPositionBucket = {
  groupKey: string;
  groupLabel: string;
  xBin: number;
  yBin: number;
  xs: number[];
  ys: number[];
  rounds: Set<string>;
};

const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];
const utilityColors: Record<string, string> = {
  flashbang: "#facc15",
  flash: "#facc15",
  hegrenade: "#fb923c",
  grenade: "#fb923c",
  smokegrenade: "#e5e7eb",
  smoke: "#e5e7eb",
  molotov: "#ef4444",
  inferno: "#ef4444",
  incgrenade: "#ef4444",
  incendiary: "#ef4444",
};
const MAX_SEGMENT_GAP_SECONDS = 1;
const MAX_SEGMENT_DISTANCE = 180;

export const mapRadars: Record<string, RadarConfig> = {
  de_ancient: {
    imageUrl: "/maps/de_ancient_radar.png",
    imageSize: 1024,
    posX: -2953,
    posY: 2164,
    scale: 5,
  },
  de_anubis: {
    imageUrl: "/maps/de_anubis_radar.png",
    imageSize: 1024,
    posX: -2796,
    posY: 3328,
    scale: 5.22,
  },
  de_cache: {
    imageUrl: "/maps/de_cache_radar.png",
    imageSize: 1024,
    posX: -2000,
    posY: 3250,
    scale: 5.5,
  },
  de_dust2: {
    imageUrl: "/maps/de_dust2_radar.png",
    imageSize: 1024,
    posX: -2476,
    posY: 3239,
    scale: 4.4,
  },
  de_inferno: {
    imageUrl: "/maps/de_inferno_radar.png",
    imageSize: 1024,
    posX: -2087,
    posY: 3870,
    scale: 4.9,
  },
  de_mirage: {
    imageUrl: "/maps/de_mirage_radar.png",
    imageSize: 1024,
    posX: -3230,
    posY: 1713,
    scale: 5,
  },
  de_nuke: {
    imageUrl: "/maps/de_nuke_radar.png",
    imageSize: 1024,
    posX: -3453,
    posY: 2887,
    scale: 7,
  },
  de_overpass: {
    imageUrl: "/maps/de_overpass_radar.png",
    imageSize: 1024,
    posX: -4831,
    posY: 1781,
    scale: 5.2,
  },
  de_train: {
    imageUrl: "/maps/de_train_radar.png",
    imageSize: 1024,
    posX: -2477,
    posY: 2392,
    scale: 4.7,
  },
  de_vertigo: {
    imageUrl: "/maps/de_vertigo_970160341.png",
    imageSize: 1024,
    posX: -3168,
    posY: 1762,
    scale: 4,
  },
};

function fittedRadar(samples: PositionSample[]): RadarConfig {
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const worldWidth = Math.max(1, maxX - minX);
  const worldHeight = Math.max(1, maxY - minY);
  const scale = Math.max(worldWidth, worldHeight) / 820;
  return {
    imageSize: 1024,
    posX: minX - scale * 102,
    posY: maxY + scale * 102,
    scale,
  };
}

function resolveRadar(mapName: string, samples: PositionSample[]) {
  const configured = mapRadars[mapName];
  if (configured?.posX !== undefined && configured.posY !== undefined && configured.scale !== undefined) {
    return configured;
  }
  return { ...fittedRadar(samples), imageUrl: configured?.imageUrl };
}

export function toRadarPoint(sample: Pick<PositionSample, "x" | "y">, radar: RadarConfig) {
  if (radar.posX === undefined || radar.posY === undefined || radar.scale === undefined) {
    return { x: 0, y: 0 };
  }
  return {
    x: (sample.x - radar.posX) / radar.scale,
    y: (radar.posY - sample.y) / radar.scale,
  };
}

type RoundPathPreviewProps = {
  title: string;
  mapName: string;
  samples: PositionSample[];
  utilities?: UtilitySample[];
  showHeatmap?: boolean;
  showCommonPositions?: boolean;
  commonPositionSamples?: PositionSample[];
  allowFullscreen?: boolean;
  density?: "default" | "compact" | "modal";
  filterGroups?: PreviewFilterGroup[];
  maxLegendItems?: number;
};

export function RoundPathPreview(props: RoundPathPreviewProps) {
  const density = props.density ?? "default";
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(density === "modal");

  useEffect(() => {
    if (density === "modal") return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      setIsNearViewport(entries.some((entry) => entry.isIntersecting));
    }, { rootMargin: "300px 0px" });

    const node = placeholderRef.current;
    if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [density]);

  if (isNearViewport) {
    return (
      <div ref={placeholderRef}>
        <RoundPathPreviewInner {...props} />
      </div>
    );
  }

  return (
    <div ref={placeholderRef} className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <span className="text-xs text-slate-500">Loads when visible</span>
      </div>
      <div
        className="grid place-items-center rounded bg-slate-950 text-xs font-medium text-slate-400"
        style={radarContainerStyle(density)}
      >
        Radar preview
      </div>
    </div>
  );
}

function RoundPathPreviewInner({
  title,
  mapName,
  samples,
  utilities = [],
  showHeatmap = false,
  showCommonPositions = false,
  commonPositionSamples,
  allowFullscreen = false,
  density = "default",
  filterGroups = [],
  maxLegendItems = 10,
}: RoundPathPreviewProps) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [heatmapEnabled, setHeatmapEnabled] = useState(showHeatmap);
  const [commonPositionsEnabled, setCommonPositionsEnabled] = useState(showCommonPositions);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [enabledGroups, setEnabledGroups] = useState(() => new Set(filterGroups.map((group) => group.id)));

  useEffect(() => {
    setEnabledGroups(new Set(filterGroups.map((group) => group.id)));
  }, [filterGroups]);

  const activeGroupIds = useMemo(() => new Set(filterGroups.map((group) => group.id)), [filterGroups]);
  const filteredSamples = useMemo(() => {
    if (filterGroups.length === 0) return samples;
    return samples.filter((sample) => sample.filterGroup && enabledGroups.has(sample.filterGroup));
  }, [enabledGroups, filterGroups.length, samples]);
  const filteredUtilities = useMemo(() => {
    if (filterGroups.length === 0) return utilities;
    return utilities.filter((utility) => utility.filterGroup && enabledGroups.has(utility.filterGroup));
  }, [enabledGroups, filterGroups.length, utilities]);
  const filteredCommonPositionSamples = useMemo(() => {
    const source = commonPositionSamples ?? samples;
    if (filterGroups.length === 0) return source;
    return source.filter((sample) => sample.filterGroup && enabledGroups.has(sample.filterGroup));
  }, [commonPositionSamples, enabledGroups, filterGroups.length, samples]);
  const baseColorKeys = useMemo(() => {
    const byTrack = new Map<string, string>();
    for (const sample of samples) {
      const id = sample.trackId ?? sample.playerName;
      byTrack.set(id, sample.colorKey ?? id);
    }
    return [...new Set([...byTrack.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map((entry) => entry[1]))];
  }, [samples]);

  const ordered = useMemo(() => [...filteredSamples].sort((a, b) => (
    a.seconds - b.seconds ||
    (a.tick ?? 0) - (b.tick ?? 0) ||
    a.playerName.localeCompare(b.playerName)
  )), [filteredSamples]);
  const duration = ordered.length ? Math.max(...ordered.map((sample) => sample.seconds)) : 0;
  const allTracks = useMemo(() => {
    const byTrack = new Map<string, { label: string; colorKey: string }>();
    for (const sample of ordered) {
      const id = sample.trackId ?? sample.playerName;
      byTrack.set(id, { label: sample.playerName, colorKey: sample.colorKey ?? id });
    }
    return [...byTrack.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [ordered]);
  const legendTracks = useMemo(() => allTracks.slice(0, maxLegendItems), [allTracks, maxLegendItems]);
  const colorForTrack = (track: { colorKey: string }) => colors[Math.max(0, baseColorKeys.indexOf(track.colorKey)) % colors.length];
  const radar = useMemo(() => (ordered.length ? resolveRadar(mapName, ordered) : undefined), [mapName, ordered]);
  const heatmapPoints = useMemo(() => (
    radar && heatmapEnabled ? buildHeatmapPoints(ordered, radar) : []
  ), [ordered, radar, heatmapEnabled]);
  const commonPositions = useMemo(() => (
    radar && commonPositionsEnabled ? buildTopPositions(filteredCommonPositionSamples, radar) : []
  ), [filteredCommonPositionSamples, radar, commonPositionsEnabled]);
  const diagnostics = useMemo(() => (
    radar ? buildPathDiagnostics(ordered, radar) : []
  ), [ordered, radar]);

  useEffect(() => {
    if (!playing || duration <= 0) return;
    const interval = window.setInterval(() => {
      setTime((value) => {
        const next = value + 0.75;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [playing, duration]);

  useEffect(() => {
    if (!fullscreenOpen) return;
    setPlaying(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreenOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreenOpen]);

  const visible = useMemo(() => ordered.filter((sample) => sample.seconds <= time), [ordered, time]);
  const visibleByTrack = useMemo(() => {
    const byTrack = new Map<string, PositionSample[]>();
    for (const track of allTracks) byTrack.set(track.id, []);
    for (const sample of visible) {
      const id = sample.trackId ?? sample.playerName;
      byTrack.get(id)?.push(sample);
    }
    return byTrack;
  }, [allTracks, visible]);
  const firstSampleByTrack = useMemo(() => {
    const byTrack = new Map<string, PositionSample>();
    for (const sample of ordered) {
      const id = sample.trackId ?? sample.playerName;
      if (!byTrack.has(id)) byTrack.set(id, sample);
    }
    return byTrack;
  }, [ordered]);
  const visibleUtilities = useMemo(() => filteredUtilities.filter((item) => {
    const duration = item.durationSeconds ?? 2;
    const flightStart = utilityFlightStart(item);
    return flightStart <= time && time <= item.seconds + duration;
  }), [filteredUtilities, time]);
  const currentByTrack = useMemo(() => allTracks.map((track) => {
    const playerSamples = visibleByTrack.get(track.id) ?? [];
    return playerSamples[playerSamples.length - 1] ?? firstSampleByTrack.get(track.id);
  }), [allTracks, firstSampleByTrack, visibleByTrack]);
  const radarBoxStyle = radarContainerStyle(density);
  const displayRadar = useMemo(() => (
    radar ?? (samples.length ? resolveRadar(mapName, samples) : undefined)
  ), [mapName, radar, samples]);
  const trackSegmentsByTrack = useMemo(() => {
    const byTrack = new Map<string, string[]>();
    if (!displayRadar) return byTrack;
    for (const track of allTracks) {
      byTrack.set(track.id, buildTrackSegments(visibleByTrack.get(track.id) ?? [], displayRadar));
    }
    return byTrack;
  }, [allTracks, displayRadar, visibleByTrack]);

  if (samples.length === 0 || !displayRadar) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        {title}: no path samples yet
      </div>
    );
  }

  const preview = fullscreenOpen ? null : (
    <div className={density === "modal"
      ? "flex max-h-[calc(100vh-96px)] w-[min(96vw,fit-content)] max-w-[1200px] flex-col overflow-hidden bg-white"
      : "rounded border border-slate-200 bg-white p-3"}
    >
      <div className={`mb-2 flex items-center gap-3 ${density === "modal" ? "justify-end" : "justify-between"}`}>
        {density !== "modal" ? <h3 className="text-sm font-semibold">{title}</h3> : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {showHeatmap ? (
            <button
              type="button"
              onClick={() => setHeatmapEnabled((value) => !value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              Heatmap {heatmapEnabled ? "on" : "off"}
            </button>
          ) : null}
          {showCommonPositions ? (
            <button
              type="button"
              onClick={() => setCommonPositionsEnabled((value) => !value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400"
            >
              Defaults {commonPositionsEnabled ? "on" : "off"}
            </button>
          ) : null}
          <span className="text-xs text-slate-500">{time.toFixed(1)}s / {duration.toFixed(1)}s</span>
        </div>
      </div>
      <div className="relative overflow-hidden rounded bg-slate-950" style={radarBoxStyle}>
        {allowFullscreen ? (
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="absolute right-2 top-2 z-10 rounded border border-white/30 bg-slate-950/75 px-2 py-1 text-xs font-medium text-white shadow-sm hover:bg-slate-900"
          >
            Fullscreen
          </button>
        ) : null}
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${displayRadar.imageSize} ${displayRadar.imageSize}`}>
          {displayRadar.imageUrl ? (
            <image href={displayRadar.imageUrl} x="0" y="0" width={displayRadar.imageSize} height={displayRadar.imageSize} opacity="0.9" />
          ) : (
            <rect x="0" y="0" width={displayRadar.imageSize} height={displayRadar.imageSize} fill="#020617" />
          )}
          {ordered.length === 0 ? (
            <text x={displayRadar.imageSize / 2} y={displayRadar.imageSize / 2} textAnchor="middle" fill="#cbd5e1" fontSize="28" fontWeight="700">
              No demos selected
            </text>
          ) : null}
          {heatmapPoints.map((point) => (
            <g key={`${point.x}-${point.y}-${point.weight}`}>
              <circle cx={point.x} cy={point.y} r={point.radius} fill={point.color} opacity={point.opacity} />
              <circle cx={point.x} cy={point.y} r={Math.max(7, point.radius * 0.28)} fill="#fff7ad" opacity={point.coreOpacity} />
            </g>
          ))}
          {allTracks.map((track, index) => {
            const segments = trackSegmentsByTrack.get(track.id) ?? [];
            return segments.map((segment, segmentIndex) => (
              <path
                key={`${track.id}-${segmentIndex}`}
                d={segment}
                fill="none"
                stroke={colorForTrack(track)}
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.65"
              />
            ));
          })}
          {visibleUtilities.map((utility) => {
            const flight = utilityFlightAtTime(utility, displayRadar, time, ordered);
            const point = flight?.point ?? null;
            if (!point) return null;
            const color = utilityColor(utility.grenadeType);
            const landed = time >= utility.seconds;
            return (
              <g key={utility.id}>
                {!landed && flight?.start ? (
                  <line
                    x1={flight.start.x}
                    y1={flight.start.y}
                    x2={point.x}
                    y2={point.y}
                    stroke={color}
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray="10 10"
                    opacity="0.75"
                  />
                ) : null}
                <circle cx={point.x} cy={point.y} r={landed ? "13" : "9"} fill={color} opacity="0.85" stroke="white" strokeWidth="3" />
                <text x={point.x + 17} y={point.y + 5} fill="white" fontSize="16" fontWeight="700">{utilityLabel(utility.grenadeType)}</text>
              </g>
            );
          })}
          {currentByTrack.map((sample, index) => {
            if (!sample) return null;
            const point = toRadarPoint(sample, displayRadar);
            const track = allTracks[index];
            return (
              <g key={`${sample.playerName}-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="12"
                  fill={sample.alive === false ? "#64748b" : colorForTrack(track)}
                  stroke="white"
                  strokeWidth="4"
                  opacity={sample.alive === false ? 0.4 : 1}
                />
                <text x={point.x + 16} y={point.y + 4} fill="white" fontSize="18" fontWeight="700">{sample.markerLabel ?? index + 1}</text>
              </g>
            );
          })}
          {commonPositions.map((position) => (
            <g key={`${position.groupKey}-${position.rank}`}>
              <circle
                cx={position.x}
                cy={position.y}
                r={position.radius}
                fill="#ef4444"
                opacity="0.92"
                stroke="#111827"
                strokeWidth="3"
              />
              <text
                x={position.x}
                y={position.y + 5}
                textAnchor="middle"
                fill="white"
                fontSize="16"
                fontWeight="800"
              >
                {position.rank}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (time >= duration) setTime(0);
            setPlaying((value) => !value);
          }}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium"
        >
          {playing ? "Pause" : time >= duration ? "Replay" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.25}
          value={time}
          onChange={(event) => {
            setPlaying(false);
            setTime(Number(event.target.value));
          }}
          className="w-full"
        />
      </div>
      {filterGroups.length ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEnabledGroups(new Set(activeGroupIds))}
              className="rounded border border-slate-300 px-2 py-1 font-medium hover:border-slate-400"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setEnabledGroups(new Set())}
              className="rounded border border-slate-300 px-2 py-1 font-medium hover:border-slate-400"
            >
              None
            </button>
            <span className="text-slate-500">{enabledGroups.size}/{filterGroups.length} demos visible</span>
            {filteredUtilities.length ? <span className="text-slate-500">{filteredUtilities.length} utility events</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {filterGroups.map((group) => {
              const checked = enabledGroups.has(group.id);
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setEnabledGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    });
                  }}
                  title={group.detail}
                  className={`rounded border px-2 py-1 font-medium ${checked ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {legendTracks.map((track, index) => (
            <div key={track.id} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorForTrack(track) }} />
              <span className="truncate">{index + 1}. {track.label}</span>
            </div>
          ))}
          {allTracks.length > legendTracks.length ? (
            <div className="text-slate-500">+{allTracks.length - legendTracks.length} more drawn</div>
          ) : null}
          {utilities.length ? (
            <div className="text-slate-500">{utilities.length} utility events</div>
          ) : null}
        </div>
      )}
      {diagnostics.length ? (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium">Path diagnostics</summary>
          <div className="mt-1 max-h-24 overflow-auto rounded bg-slate-50 p-2">
            {diagnostics.slice(0, 8).map((item) => (
              <div key={`${item.trackId}-${item.tick}`}>
                {item.trackId}: jump {Math.round(item.distance)}px at {item.seconds.toFixed(2)}s / tick {item.tick}
              </div>
            ))}
            {diagnostics.length > 8 ? <div>+{diagnostics.length - 8} more</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );

  return (
    <>
      {preview}
      {fullscreenOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setFullscreenOpen(false)}
        >
          <div
            className="flex max-h-[calc(100vh-32px)] w-fit max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded border border-slate-200 bg-white p-3 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3 text-slate-900">
              <h2 className="text-sm font-semibold">{title}</h2>
              <button
                type="button"
                onClick={() => setFullscreenOpen(false)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 overflow-hidden">
              <RoundPathPreview
                title={title}
                mapName={mapName}
                samples={samples}
                utilities={utilities}
                showHeatmap={showHeatmap}
                showCommonPositions={showCommonPositions}
                commonPositionSamples={commonPositionSamples}
                allowFullscreen={false}
                density="modal"
                filterGroups={filterGroups}
                maxLegendItems={Math.max(maxLegendItems, 12)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function radarContainerStyle(density: "default" | "compact" | "modal"): CSSProperties {
  if (density === "modal") {
    return {
      width: "min(calc(100vw - 96px), calc(100vh - 320px), 880px)",
      aspectRatio: "1 / 1",
      marginInline: "auto",
      flexShrink: 0,
    };
  }
  if (density === "compact") {
    return {
      width: "min(100%, 560px)",
      aspectRatio: "1 / 1",
      marginInline: "auto",
    };
  }
  return { aspectRatio: "1 / 1" };
}

function buildTrackSegments(samples: PositionSample[], radar: RadarConfig) {
  const segments: string[] = [];
  let current: string[] = [];
  let previous: { point: { x: number; y: number }; sample: PositionSample } | null = null;

  for (const sample of samples) {
    if (sample.alive === false) {
      if (current.length > 1) segments.push(pointsToPath(current));
      current = [];
      previous = null;
      continue;
    }

    const point = toRadarPoint(sample, radar);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;

    const shouldSplit = previous
      ? sample.seconds - previous.sample.seconds > MAX_SEGMENT_GAP_SECONDS ||
        distance(point, previous.point) > MAX_SEGMENT_DISTANCE
      : false;

    if (shouldSplit) {
      if (current.length > 1) segments.push(pointsToPath(current));
      current = [];
    }

    current.push(`${roundPoint(point.x)},${roundPoint(point.y)}`);
    previous = { point, sample };
  }

  if (current.length > 1) segments.push(pointsToPath(current));
  return segments;
}

function buildHeatmapPoints(samples: PositionSample[], radar: RadarConfig) {
  const buckets = new Map<string, { x: number; y: number; weight: number }>();
  for (const sample of samples) {
    if (sample.alive === false) continue;
    const point = toRadarPoint(sample, radar);
    const bucketX = Math.round(point.x / 28) * 28;
    const bucketY = Math.round(point.y / 28) * 28;
    const key = `${bucketX}:${bucketY}`;
    const bucket = buckets.get(key) ?? { x: bucketX, y: bucketY, weight: 0 };
    bucket.weight += 1;
    buckets.set(key, bucket);
  }

  const values = [...buckets.values()];
  if (values.length === 0) return [];

  const weights = values.map((bucket) => bucket.weight).sort((a, b) => a - b);
  const maxWeight = weights[weights.length - 1] ?? 1;
  const hotWeight = Math.max(1, percentile(weights, 0.86));
  const floorWeight = Math.max(2, percentile(weights, 0.55));

  return values
    .map((bucket) => {
      const intensity = heatIntensity(bucket.weight, floorWeight, hotWeight, maxWeight);
      return {
        ...bucket,
        intensity,
        radius: 7 + intensity * 24,
        opacity: 0.02 + intensity * 0.28,
        coreOpacity: Math.max(0, intensity - 0.45) * 0.32,
        color: heatColor(intensity),
      };
    })
    .filter((bucket) => bucket.intensity > 0.08);
}

function heatColor(intensity: number) {
  if (intensity > 0.86) return "#dc2626";
  if (intensity > 0.58) return "#f97316";
  if (intensity > 0.28) return "#facc15";
  return "#fef3c7";
}

function heatIntensity(weight: number, floorWeight: number, hotWeight: number, maxWeight: number) {
  if (weight < floorWeight) return 0;
  const denominator = Math.max(1, hotWeight - floorWeight);
  const percentileIntensity = clamp((weight - floorWeight) / denominator, 0, 1);
  const peakBoost = maxWeight > hotWeight
    ? clamp((weight - hotWeight) / Math.max(1, maxWeight - hotWeight), 0, 1) * 0.18
    : 0;
  return Math.pow(clamp(percentileIntensity + peakBoost, 0, 1), 1.45);
}

function percentile(sortedValues: number[], quantile: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * quantile)));
  return sortedValues[index];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildTopPositions(samples: PositionSample[], radar: RadarConfig) {
  const cellSize = 100;
  const topN = 6;
  const buckets = new Map<string, TopPositionBucket>();

  for (const sample of samples) {
    if (sample.alive === false || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
    const groupKey = sample.positionGroupKey ?? sample.playerId ?? sample.colorKey ?? sample.playerName;
    const groupLabel = sample.positionGroupLabel ?? sample.playerName;
    const xBin = Math.floor(sample.x / cellSize);
    const yBin = Math.floor(sample.y / cellSize);
    const key = `${groupKey}:${xBin}:${yBin}`;
    const bucket = buckets.get(key) ?? {
      groupKey,
      groupLabel,
      xBin,
      yBin,
      xs: [],
      ys: [],
      rounds: new Set<string>(),
    };
    bucket.xs.push(sample.x);
    bucket.ys.push(sample.y);
    bucket.rounds.add(`${sample.matchId ?? "match"}:${sample.roundNumber ?? sample.tick ?? bucket.xs.length}`);
    buckets.set(key, bucket);
  }

  const byGroup = new Map<string, TopPositionBucket[]>();
  for (const bucket of buckets.values()) {
    byGroup.set(bucket.groupKey, [...(byGroup.get(bucket.groupKey) ?? []), bucket]);
  }

  return [...byGroup.values()].flatMap((groupBuckets) => (
    groupBuckets
      .sort((left, right) => (
        right.xs.length - left.xs.length ||
        right.rounds.size - left.rounds.size
      ))
      .slice(0, topN)
      .map((bucket, index) => {
        const point = toRadarPoint({ x: median(bucket.xs), y: median(bucket.ys) }, radar);
        const sampleShare = bucket.xs.length / Math.max(1, groupBuckets.reduce((total, item) => total + item.xs.length, 0));
        return {
          groupKey: bucket.groupKey,
          groupLabel: bucket.groupLabel,
          rank: index + 1,
          x: point.x,
          y: point.y,
          radius: 14 + Math.min(10, sampleShare * 40),
        };
      })
  ));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildPathDiagnostics(samples: PositionSample[], radar: RadarConfig) {
  const byTrack = new Map<string, PositionSample[]>();
  for (const sample of samples) {
    const id = sample.trackId ?? sample.playerName;
    byTrack.set(id, [...(byTrack.get(id) ?? []), sample]);
  }

  return [...byTrack.entries()].flatMap(([trackId, trackSamples]) => {
    const jumps: Array<{ trackId: string; seconds: number; tick: number | undefined; distance: number }> = [];
    let previous: { point: { x: number; y: number }; sample: PositionSample } | null = null;
    for (const sample of trackSamples) {
      if (sample.alive === false) {
        previous = null;
        continue;
      }
      const point = toRadarPoint(sample, radar);
      if (previous) {
        const jumpDistance = distance(point, previous.point);
        if (sample.seconds - previous.sample.seconds <= MAX_SEGMENT_GAP_SECONDS && jumpDistance > MAX_SEGMENT_DISTANCE) {
          jumps.push({ trackId, seconds: sample.seconds, tick: sample.tick, distance: jumpDistance });
        }
      }
      previous = { point, sample };
    }
    return jumps;
  });
}

function pointsToPath(points: string[]) {
  return `M ${points.join(" L ")}`;
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function roundPoint(value: number) {
  return Math.round(value * 10) / 10;
}

function utilityFlightAtTime(utility: UtilitySample, radar: RadarConfig, time: number, samples: PositionSample[]) {
  const start = utility.startX !== null && utility.startX !== undefined && utility.startY !== null && utility.startY !== undefined
    ? toRadarPoint({ x: utility.startX, y: utility.startY }, radar)
    : utilityStartFromSamples(utility, samples, radar);
  const end = utility.endX !== null && utility.endX !== undefined && utility.endY !== null && utility.endY !== undefined
    ? toRadarPoint({ x: utility.endX, y: utility.endY }, radar)
    : start;

  if (!end) return null;
  if (!start || time >= utility.seconds) return { point: end, start, end };

  const flightStart = utilityFlightStart(utility);
  const progress = Math.max(0, Math.min(1, (time - flightStart) / Math.max(0.1, utility.seconds - flightStart)));
  return {
    point: {
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    },
    start,
    end,
  };
}

function utilityStartFromSamples(utility: UtilitySample, samples: PositionSample[], radar: RadarConfig) {
  const sameThrower = samples.filter((sample) => (
    (!utility.throwerPlayerId || sample.playerId === utility.throwerPlayerId) &&
    (!utility.matchId || sample.matchId === utility.matchId) &&
    (utility.roundNumber === null || utility.roundNumber === undefined || sample.roundNumber === utility.roundNumber) &&
    sample.alive !== false
  ));
  if (sameThrower.length === 0) return null;

  const flightStart = utilityFlightStart(utility);
  const beforeOrAtThrow = sameThrower
    .filter((sample) => sample.seconds <= flightStart)
    .sort((a, b) => b.seconds - a.seconds)[0];
  const nearest = beforeOrAtThrow ?? sameThrower
    .sort((a, b) => Math.abs(a.seconds - flightStart) - Math.abs(b.seconds - flightStart))[0];

  return nearest ? toRadarPoint(nearest, radar) : null;
}

function utilityFlightStart(utility: UtilitySample) {
  return Math.max(0, utility.flightStartSeconds ?? utility.seconds - inferredFlightDuration(utility.grenadeType));
}

function inferredFlightDuration(type: string) {
  const lower = type.toLowerCase();
  if (lower.includes("flash")) return 1;
  if (lower.includes("he")) return 1.2;
  if (lower.includes("smoke")) return 1.8;
  if (lower.includes("molotov") || lower.includes("inc")) return 1.5;
  return 1.25;
}

function utilityColor(type: string) {
  return utilityColors[type.toLowerCase()] ?? "#a78bfa";
}

function utilityLabel(type: string) {
  const lower = type.toLowerCase();
  if (lower.includes("flash")) return "F";
  if (lower.includes("smoke")) return "S";
  if (lower.includes("molotov") || lower.includes("inc")) return "M";
  if (lower.includes("he") || lower.includes("grenade")) return "H";
  return "U";
}
