"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

const illustratedMaps = new Set(["de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno", "de_mirage", "de_nuke", "de_overpass", "de_train", "de_vertigo"]);
export function MapLink({ href, mapName, count }: { href: string; mapName: string; count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const title = mapName === "de_dust2" ? "Dust II" : mapName.replace(/^de_/, "").replace(/^./, character => character.toUpperCase());
  const artwork = illustratedMaps.has(mapName);
  return <>
    <Link
      href={href}
      aria-label={`${title}: view analysis from ${count} matches`}
      className="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-lg border border-slate-700 bg-slate-900 p-3 text-white shadow-sm transition-shadow hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      onClick={event => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) return;

        event.preventDefault();

        if (!pending) {
          startTransition(() => router.push(href));
        }
      }}
    >
      {artwork && (
        <Image
          src={`/maps/cards/${mapName}-background.png`}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, 200px"
          quality={70}
          className="object-cover opacity-75 transition-transform duration-300 motion-safe:group-hover:scale-105"
        />
      )}

      <span
        className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/10 to-transparent"
        aria-hidden="true"
      />

      {artwork && (
        <div className="relative flex flex-1 items-center justify-center">
          <Image
            src={`/maps/cards/${mapName}-icon.png`}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 -translate-y-1 object-contain drop-shadow-lg"
          />
        </div>
      )}

      <span className="relative mt-2">
        <span className="block text-lg font-bold">
          {title}
        </span>

        <span className="block text-xs text-slate-200">
          {count} {count === 1 ? "match" : "matches"}
        </span>
      </span>
    </Link>
    {pending && <div className="fixed inset-0 z-50 grid cursor-wait place-items-center bg-black/50" role="status" aria-live="polite" aria-label="Loading map overview">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-slate-800" aria-hidden="true"><div className="map-loading-bar h-full w-1/3 bg-blue-400" /></div>
      <p className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white">Loading map overview…</p>
    </div>}
  </>;
}
