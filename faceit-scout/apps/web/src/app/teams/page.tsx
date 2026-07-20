import { LineupGroupsBrowser } from "@/app/teams/lineup-groups-browser";
import { getTeams } from "@/db/queries/teams";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const teams = await getTeams();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Lineup groups</h1>
        <p className="mt-2 text-slate-600">Lineups are grouped when at least 4 players are shared, so stand-ins stay in the same scouting view.</p>
      </div>
      <LineupGroupsBrowser teams={teams} />
    </div>
  );
}
