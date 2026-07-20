import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, importedDemo, importStageLog, importStatus } from "@/db/schema";

export type ImportStatus = (typeof importStatus.enumValues)[number];
export type ImportStageLog = typeof importStageLog.$inferSelect;

export async function getImports(status?: ImportStatus) {
  const rows = await db
    .select({
      import: importedDemo,
      match: csMatch,
    })
    .from(importedDemo)
    .leftJoin(csMatch, eq(importedDemo.parsedMatchId, csMatch.id))
    .where(status ? eq(importedDemo.status, status) : undefined)
    .orderBy(desc(importedDemo.detectedAt))
    .limit(100);
  return withStageLogs(rows);
}

export async function getImportById(id: string) {
  const [row] = await db
    .select({ import: importedDemo, match: csMatch })
    .from(importedDemo)
    .leftJoin(csMatch, eq(importedDemo.parsedMatchId, csMatch.id))
    .where(eq(importedDemo.id, id))
    .limit(1);
  return row ?? null;
}

export async function getImportStageLogs(importIds: string[]) {
  if (importIds.length === 0) return new Map<string, ImportStageLog[]>();
  const rows = await db
    .select()
    .from(importStageLog)
    .where(inArray(importStageLog.importId, importIds))
    .orderBy(importStageLog.createdAt);

  const byImportId = new Map<string, ImportStageLog[]>();
  for (const row of rows) {
    byImportId.set(row.importId, [...(byImportId.get(row.importId) ?? []), row]);
  }
  return byImportId;
}

export async function withStageLogs<T extends { import: typeof importedDemo.$inferSelect }>(rows: T[]) {
  const logsByImportId = await getImportStageLogs(rows.map((row) => row.import.id));
  return rows.map((row) => ({
    ...row,
    stageLogs: logsByImportId.get(row.import.id) ?? [],
  }));
}

export function isImportStatus(value: string): value is ImportStatus {
  return importStatus.enumValues.includes(value as ImportStatus);
}
