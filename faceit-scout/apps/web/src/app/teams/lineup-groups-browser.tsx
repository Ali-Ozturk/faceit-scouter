"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LineupGroup = {
  id: string;
  displayName: string;
  playerCount: number;
  exactLineupCount: number;
  matchCount: number;
  maps: string | null;
  lastPlayedAt: Date | string | null;
  variantNames: string[];
};

export function LineupGroupsBrowser({ teams }: { teams: LineupGroup[] }) {
  const [query, setQuery] = useState("");
  const mapOptions = useMemo(() => topMaps(teams), [teams]);
  const filteredTeams = useMemo(() => searchTeams(teams, query), [query, teams]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search lineups, players, maps"
              className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-9 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </label>
          <div className="text-sm text-slate-500">
            {filteredTeams.length}/{teams.length} groups
          </div>
        </div>
        {mapOptions.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {mapOptions.map((mapName) => (
              <Button
                key={mapName}
                type="button"
                variant="secondary"
                size="sm"
                className="bg-slate-100 text-slate-700 hover:bg-cyan-100 hover:text-cyan-800"
                onClick={() => setQuery((value) => toggleTerm(value, `map:${mapName}`))}
              >
                {mapName}
              </Button>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="bg-slate-100 text-slate-700 hover:bg-violet-100 hover:text-violet-800"
              onClick={() => setQuery((value) => toggleTerm(value, "has:standin"))}
            >
              Stand-ins
            </Button>
          </div>
        ) : null}
      </div>

      {filteredTeams.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filteredTeams.map((team) => (
            <Link key={team.id} href={`/teams/${team.id}`} className="rounded border border-slate-200 bg-white p-5 hover:border-slate-400">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 font-semibold">{team.displayName}</h2>
                {team.exactLineupCount > 1 ? <Badge variant="violet">{team.exactLineupCount} variants</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-slate-600">{team.matchCount} matches · {team.playerCount} players · {team.maps ?? "No maps yet"}</p>
              <p className="mt-2 text-sm text-slate-500">Last played {formatDate(team.lastPlayedAt)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No lineup groups match this search.
        </div>
      )}
    </div>
  );
}

function searchTeams(teams: LineupGroup[], query: string) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return teams;

  return teams
    .map((team) => ({ team, score: scoreTeam(team, tokens) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || right.team.matchCount - left.team.matchCount)
    .map((result) => result.team);
}

function scoreTeam(team: LineupGroup, tokens: string[]) {
  let score = 0;
  for (const token of tokens) {
    const tokenScore = scoreToken(team, token);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

function scoreToken(team: LineupGroup, token: string) {
  const normalized = normalize(token);
  const maps = mapList(team.maps);
  const playerNames = team.displayName.split(",").map((name) => name.trim());

  const qualified = normalized.match(/^([a-z]+):(.*)$/);
  if (qualified) {
    const [, field, value] = qualified;
    if (!value) return 1;
    if (field === "map") return bestTextScore(maps, value) * 2;
    if (field === "player") return bestTextScore(playerNames, value) * 2;
    if (field === "variant") return bestTextScore(team.variantNames, value) * 2;
    if (field === "has" && ["standin", "standins", "variant", "variants"].includes(value)) {
      return team.exactLineupCount > 1 ? 4 : 0;
    }
  }

  const comparison = normalized.match(/^(matches|match|games|game|variants|variant)(>=|<=|>|<|=)(\d+)$/);
  if (comparison) {
    const [, field, operator, rawValue] = comparison;
    const current = field.startsWith("variant") ? team.exactLineupCount : team.matchCount;
    return compareNumber(current, operator, Number(rawValue)) ? 4 : 0;
  }

  return bestTextScore([
    team.displayName,
    team.maps ?? "",
    ...team.variantNames,
    `${team.matchCount} matches`,
    `${team.exactLineupCount} variants`,
  ], normalized);
}

function bestTextScore(values: string[], token: string) {
  return Math.max(0, ...values.map((value) => textScore(value, token)));
}

function textScore(value: string, token: string) {
  const normalized = normalize(value);
  if (!normalized || !token) return 0;
  if (normalized === token) return 8;
  if (normalized.startsWith(token)) return 6;
  if (normalized.includes(token)) return 4;
  return fuzzyIncludes(normalized, token) ? 2 : 0;
}

function fuzzyIncludes(value: string, token: string) {
  let index = 0;
  for (const character of token) {
    index = value.indexOf(character, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

function tokenize(value: string) {
  const matches = value.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  return matches.map((match) => match.replace(/^["']|["']$/g, "")).filter(Boolean);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/^de_/, "").replace(/[^a-z0-9:>=<]+/g, "");
}

function mapList(value: string | null) {
  return value?.split(",").map((mapName) => mapName.trim()).filter(Boolean) ?? [];
}

function topMaps(teams: LineupGroup[]) {
  const counts = new Map<string, number>();
  for (const team of teams) {
    for (const mapName of mapList(team.maps)) counts.set(mapName, (counts.get(mapName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([mapName]) => mapName);
}

function toggleTerm(query: string, term: string) {
  const tokens = tokenize(query);
  const normalizedTerm = normalize(term);
  const withoutTerm = tokens.filter((token) => normalize(token) !== normalizedTerm);
  return withoutTerm.length === tokens.length ? [...tokens, term].join(" ") : withoutTerm.join(" ");
}

function compareNumber(current: number, operator: string, expected: number) {
  if (operator === ">=") return current >= expected;
  if (operator === "<=") return current <= expected;
  if (operator === ">") return current > expected;
  if (operator === "<") return current < expected;
  return current === expected;
}
