import { count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, importedDemo, teamLineup } from "@/db/schema";
import { getTeams } from "@/db/queries/teams";
import { withStageLogs } from "@/db/queries/imports";

export async function getDashboard() {
  const [totalImports] = await db.select({ value: count() }).from(importedDemo);
  const [completedImports] = await db.select({ value: count() }).from(importedDemo).where(eq(importedDemo.status, "COMPLETED"));
  const [failedImports] = await db.select({ value: count() }).from(importedDemo).where(eq(importedDemo.status, "FAILED"));
  const [activeImports] = await db
    .select({ value: count() })
    .from(importedDemo)
    .where(sql`${importedDemo.status} in ('DISCOVERED','WAITING_FOR_STABILITY','CLAIMED','DECOMPRESSING','PARSING','PERSISTING')`);
  const [matches] = await db.select({ value: count() }).from(csMatch);
  const [lineups] = await db.select({ value: count() }).from(teamLineup);
  const recentImports = await withStageLogs(
    (await db.select({ import: importedDemo }).from(importedDemo).orderBy(desc(importedDemo.detectedAt)).limit(8))
  );
  const latestLineups = (await getTeams()).slice(0, 8);

  return {
    stats: {
      totalImports: totalImports.value,
      completedImports: completedImports.value,
      failedImports: failedImports.value,
      activeImports: activeImports.value,
      matches: matches.value,
      lineups: lineups.value,
    },
    recentImports,
    latestLineups,
  };
}
