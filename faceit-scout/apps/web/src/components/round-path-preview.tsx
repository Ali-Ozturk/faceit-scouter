"use client";

import { useEffect, useMemo, useState } from "react";

type PositionSample = {
  trackId?: string;
  colorKey?: string;
  markerLabel?: string;
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
  grenadeType: string;
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

export function RoundPathPreview({
  title,
  mapName,
  samples,
  utilities = [],
  showHeatmap = false,
  maxLegendItems = 10,
}: {
  title: string;
  mapName: string;
  samples: PositionSample[];
  utilities?: UtilitySample[];
  showHeatmap?: boolean;
  maxLegendItems?: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const ordered = useMemo(() => [...samples].sort((a, b) => (
    a.seconds - b.seconds ||
    (a.tick ?? 0) - (b.tick ?? 0) ||
    a.playerName.localeCompare(b.playerName)
  )), [samples]);
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
  const colorKeys = useMemo(() => [...new Set(allTracks.map((track) => track.colorKey))], [allTracks]);
  const colorForTrack = (track: { colorKey: string }) => colors[Math.max(0, colorKeys.indexOf(track.colorKey)) % colors.length];
  const radar = useMemo(() => (ordered.length ? resolveRadar(mapName, ordered) : undefined), [mapName, ordered]);
  const heatmapPoints = useMemo(() => (
    radar && showHeatmap ? buildHeatmapPoints(ordered, radar) : []
  ), [ordered, radar, showHeatmap]);
  const diagnostics = useMemo(() => (
    radar ? buildPathDiagnostics(ordered, radar) : []
  ), [ordered, radar]);

  useEffect(() => {
    if (!playing || duration <= 0) return;
    const interval = window.setInterval(() => {
      setTime((value) => {
        const next = value + 0.25;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [playing, duration]);

  if (ordered.length === 0 || !radar) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        {title}: no path samples yet
      </div>
    );
  }

  const visible = ordered.filter((sample) => sample.seconds <= time);
  const visibleUtilities = utilities.filter((item) => {
    const duration = item.durationSeconds ?? 2;
    return item.seconds <= time && time <= item.seconds + duration;
  });
  const currentByTrack = allTracks.map((track) => {
    const playerSamples = visible.filter((sample) => (sample.trackId ?? sample.playerName) === track.id);
    return playerSamples[playerSamples.length - 1] ?? ordered.find((sample) => (sample.trackId ?? sample.playerName) === track.id);
  });

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-slate-500">{time.toFixed(1)}s / {duration.toFixed(1)}s</span>
      </div>
      <div className="relative overflow-hidden rounded bg-slate-950" style={{ aspectRatio: "1 / 1" }}>
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${radar.imageSize} ${radar.imageSize}`}>
          {radar.imageUrl ? (
            <image href={radar.imageUrl} x="0" y="0" width={radar.imageSize} height={radar.imageSize} opacity="0.9" />
          ) : (
            <rect x="0" y="0" width={radar.imageSize} height={radar.imageSize} fill="#020617" />
          )}
          {heatmapPoints.map((point) => (
            <circle
              key={`${point.x}-${point.y}-${point.weight}`}
              cx={point.x}
              cy={point.y}
              r={point.radius}
              fill="#38bdf8"
              opacity={point.opacity}
            />
          ))}
          {allTracks.map((track, index) => {
            const playerSamples = visible.filter((sample) => (sample.trackId ?? sample.playerName) === track.id);
            const segments = buildTrackSegments(playerSamples, radar);
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
            const point = utility.endX !== null && utility.endX !== undefined && utility.endY !== null && utility.endY !== undefined
              ? toRadarPoint({ x: utility.endX, y: utility.endY }, radar)
              : utility.startX !== null && utility.startX !== undefined && utility.startY !== null && utility.startY !== undefined
                ? toRadarPoint({ x: utility.startX, y: utility.startY }, radar)
                : null;
            if (!point) return null;
            const color = utilityColor(utility.grenadeType);
            return (
              <g key={utility.id}>
                <circle cx={point.x} cy={point.y} r="13" fill={color} opacity="0.85" stroke="white" strokeWidth="3" />
                <text x={point.x + 17} y={point.y + 5} fill="white" fontSize="16" fontWeight="700">{utilityLabel(utility.grenadeType)}</text>
              </g>
            );
          })}
          {currentByTrack.map((sample, index) => {
            if (!sample) return null;
            const point = toRadarPoint(sample, radar);
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
    const bucketX = Math.round(point.x / 34) * 34;
    const bucketY = Math.round(point.y / 34) * 34;
    const key = `${bucketX}:${bucketY}`;
    const bucket = buckets.get(key) ?? { x: bucketX, y: bucketY, weight: 0 };
    bucket.weight += 1;
    buckets.set(key, bucket);
  }

  const maxWeight = Math.max(1, ...[...buckets.values()].map((bucket) => bucket.weight));
  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    radius: 16 + (bucket.weight / maxWeight) * 34,
    opacity: 0.08 + (bucket.weight / maxWeight) * 0.24,
  }));
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
