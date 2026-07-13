"use client";

import { useEffect, useMemo, useState } from "react";

type PositionSample = {
  side: string;
  seconds: number;
  playerName: string;
  x: number;
  y: number;
  alive: boolean | null;
};

type RadarConfig = {
  imageUrl?: string;
  imageSize: number;
  posX?: number;
  posY?: number;
  scale?: number;
};

const colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c"];

const mapRadars: Record<string, RadarConfig> = {
  de_ancient: {
    imageUrl: "/maps/de_ancient_radar.png",
    imageSize: 1024,
    posX: -3000,
    posY: 3250,
    scale: 5.5,
  },
  de_anubis: {
    imageUrl: "/maps/de_anubis_radar.png",
    imageSize: 1024,
    posX: -3000,
    posY: 3250,
    scale: 5.5,
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

function toRadarPoint(sample: PositionSample, radar: RadarConfig) {
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
}: {
  title: string;
  mapName: string;
  samples: PositionSample[];
}) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);

  const ordered = useMemo(() => [...samples].sort((a, b) => a.seconds - b.seconds), [samples]);
  const duration = ordered.length ? Math.max(...ordered.map((sample) => sample.seconds)) : 0;
  const players = useMemo(() => [...new Set(ordered.map((sample) => sample.playerName))].sort(), [ordered]);
  const radar = useMemo(() => (ordered.length ? resolveRadar(mapName, ordered) : undefined), [mapName, ordered]);

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
  const currentByPlayer = players.map((playerName) => {
    const playerSamples = visible.filter((sample) => sample.playerName === playerName);
    return playerSamples[playerSamples.length - 1] ?? ordered.find((sample) => sample.playerName === playerName);
  });

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-slate-500">{time.toFixed(1)}s / {duration.toFixed(1)}s</span>
      </div>
      <div className="relative overflow-hidden rounded bg-slate-950" style={{ aspectRatio: "1 / 1" }}>
        {radar.imageUrl ? (
          <img src={radar.imageUrl} alt={`${mapName} radar`} className="absolute inset-0 h-full w-full object-cover opacity-90" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,#334155_1px,transparent_1px)] [background-size:32px_32px]" />
        )}
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${radar.imageSize} ${radar.imageSize}`}>
          {players.map((playerName, index) => {
            const playerSamples = visible.filter((sample) => sample.playerName === playerName);
            const points = playerSamples.map((sample) => {
              const point = toRadarPoint(sample, radar);
              return `${point.x},${point.y}`;
            }).join(" ");
            return points ? (
              <polyline
                key={playerName}
                points={points}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="7"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.75"
              />
            ) : null;
          })}
          {currentByPlayer.map((sample, index) => {
            if (!sample) return null;
            const point = toRadarPoint(sample, radar);
            return (
              <g key={`${sample.playerName}-${index}`}>
                <circle cx={point.x} cy={point.y} r="12" fill={sample.alive === false ? "#64748b" : colors[index % colors.length]} stroke="white" strokeWidth="4" />
                <text x={point.x + 16} y={point.y + 4} fill="white" fontSize="18" fontWeight="700">{index + 1}</text>
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
        {players.map((playerName, index) => (
          <div key={playerName} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
            <span className="truncate">{index + 1}. {playerName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
