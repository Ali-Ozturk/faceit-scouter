import Link from "next/link";
import { getTeams } from "@/db/queries/teams";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const teams = await getTeams();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Lineup groups</h1>
        <p className="mt-2 text-slate-600">Lineups are grouped when at least 4 players are shared, so stand-ins stay in the same scouting view.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {teams.map((team) => (
          <Link key={team.id} href={`/teams/${team.id}`} className="rounded border border-slate-200 bg-white p-5 hover:border-slate-400">
            <h2 className="font-semibold">{team.displayName}</h2>
            <p className="mt-2 text-sm text-slate-600">{team.matchCount} matches · {team.exactLineupCount} variants · {team.maps ?? "No maps yet"}</p>
            <p className="mt-2 text-sm text-slate-500">Last played {formatDate(team.lastPlayedAt)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
