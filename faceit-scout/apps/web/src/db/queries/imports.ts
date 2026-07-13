import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { csMatch, importedDemo, importStatus } from "@/db/schema";

export type ImportStatus = (typeof importStatus.enumValues)[number];

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
  return rows;
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

export function isImportStatus(value: string): value is ImportStatus {
  return importStatus.enumValues.includes(value as ImportStatus);
}
