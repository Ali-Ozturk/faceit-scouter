import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => {
  const data = { active: [] as Array<{ faceitMatchId: string }>, inserted: [] as Array<Record<string, unknown>>, metadata: {} as Record<string, unknown> };
  const chain = (rows: unknown[]) => ({
    from() { return this; }, where() { return this; }, innerJoin() { return this; },
    limit: async () => rows,
    then(resolve: (value: unknown[]) => unknown) { return Promise.resolve(rows).then(resolve); },
  });
  const tx = {
    execute: async () => undefined,
    select: (fields?: Record<string, unknown>) => chain(!fields ? data.active : "requesterNickname" in fields ? [data.metadata] : data.inserted.map((row, index) => ({ id: String(index), faceitMatchId: row.faceitMatchId, status: "QUEUED" }))),
    insert: () => ({ values: async (value: Record<string, unknown>) => { data.inserted.push(value); } }),
  };
  return { data, tx };
});
vi.mock("@/db", () => ({ db: { transaction: async (fn: (tx: typeof state.tx) => Promise<unknown>) => fn(state.tx) } }));
import { POST } from "./route";
const matchId = "1-2b2a3f77-0a37-4b74-96a3-7f03ae193491";
const demo = { faceitMatchId: matchId, url: "https://demos-europe-central-faceit-cdn.s3.eu-central-003.backblazeb2.com/test.dem.zst" };
function request(metadata: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/demo-downloads", { method: "POST", headers: { Authorization: `Bearer ${"x".repeat(32)}` }, body: JSON.stringify({ demos: [{ ...demo, ...metadata }] }) });
}
beforeEach(() => { state.data.active = []; state.data.inserted = []; state.data.metadata = {}; vi.stubEnv("SCOUT_IMPORT_KEY", "x".repeat(32)); });
afterEach(() => vi.unstubAllEnvs());
it("persists original analysis metadata even when the extension snapshot is missing", async () => {
  state.data.metadata = { requesterNickname: "aliyo", playedAt: new Date("2026-09-13T20:00:00Z"), mapName: "de_inferno" };
  const response = await POST(request({ analysisId: "2b2a3f77-0a37-4b74-96a3-7f03ae193491" }));
  expect(response.status).toBe(202);
  expect(state.data.inserted[0]).toMatchObject({ requesterNickname: "aliyo", matchPlayedAt: new Date("2026-09-13T20:00:00Z"), mapName: "de_inferno" });
});
it("preserves metadata supplied by an extension without an analysis reference", async () => {
  expect((await POST(request({ requesterNickname: "snapshot-player", matchPlayedAt: "2026-09-13T20:00:00Z", mapName: "de_nuke" }))).status).toBe(202);
  expect(state.data.inserted[0]).toMatchObject({ requesterNickname: "snapshot-player", matchPlayedAt: new Date("2026-09-13T20:00:00Z"), mapName: "de_nuke" });
});
it("admits a ninth outstanding job and rejects a tenth", async () => {
  state.data.active = Array.from({ length: 8 }, (_, index) => ({ faceitMatchId: String(index) }));
  expect((await POST(request())).status).toBe(202);
  state.data.active.push({ faceitMatchId: "ninth" });
  expect((await POST(request())).status).toBe(409);
  expect(state.data.inserted).toHaveLength(1);
});
