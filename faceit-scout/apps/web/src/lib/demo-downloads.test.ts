import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeDemoRequest, demoRequest, isDemoUrl, hasQueueCapacity } from "./demo-downloads";

const host = "demos-europe-central-faceit-cdn.s3.eu-central-003.backblazeb2.com";
const demo = { faceitMatchId: "1-2b2a3f77-0a37-4b74-96a3-7f03ae193491", url: `https://${host}/a.dem.zst?signature=test` };
afterEach(() => vi.unstubAllEnvs());
describe("URL import admission", () => {
  it("allows nine outstanding demos, rejects a tenth, and reuses active matches", () => {
    const active = Array.from({ length: 6 }, (_, i) => String(i));
    expect(hasQueueCapacity(active, ["6", "7", "8"])).toBe(true);
    expect(hasQueueCapacity([...active, "6", "7"], ["8", "9"])).toBe(false);
    expect(hasQueueCapacity([...active, "6", "7", "8"], ["8"])).toBe(true);
  });
  it("accepts display metadata and legacy requests, rejecting malformed dates", () => {
    expect(demoRequest.parse({ demos: [{ ...demo, requesterNickname: " Ali ", matchPlayedAt: "2026-09-13T18:00:00+02:00", mapName: "de_inferno" }] }).demos[0].requesterNickname).toBe("Ali");
    expect(demoRequest.safeParse({ demos: [demo] }).success).toBe(true);
    expect(demoRequest.safeParse({ demos: [{ ...demo, matchPlayedAt: "yesterday" }] }).success).toBe(false);
    expect(demoRequest.safeParse({ demos: [{ ...demo, requesterNickname: "x".repeat(101) }] }).success).toBe(false);
  });
  it("requires authentication even on localhost", () => {
    vi.stubEnv("SCOUT_IMPORT_KEY", "a".repeat(32));
    expect(authorizeDemoRequest(new Request("http://localhost"))).toBe(false);
    expect(authorizeDemoRequest(new Request("http://localhost", { headers: { authorization: `Bearer ${"a".repeat(32)}` } }))).toBe(true);
  });
  it("rejects a fourth demo and arbitrary hosts", () => {
    expect(demoRequest.safeParse({ demos: [demo, demo, demo] }).success).toBe(true);
    expect(demoRequest.safeParse({ demos: [demo, demo, demo, demo] }).success).toBe(false);
    expect(isDemoUrl(`https://${host}.evil.example/a.dem`)).toBe(false);
    expect(isDemoUrl("http://127.0.0.1/a.dem")).toBe(false);
    expect(isDemoUrl(`https://user:secret@${host}/a.dem`)).toBe(false);
  });
});
