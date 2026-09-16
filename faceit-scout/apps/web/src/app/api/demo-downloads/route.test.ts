import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { POST } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("rejects old extensions even with a valid import key", async () => {
  vi.stubEnv("SCOUT_IMPORT_KEY", "x".repeat(32));
  expect((await POST(new Request("http://localhost/api/demo-downloads", {method:"POST",headers:{Authorization:`Bearer ${"x".repeat(32)}`}}))).status).toBe(410);
});
it("requires authentication before responding to legacy submissions", async () => {
  vi.stubEnv("SCOUT_IMPORT_KEY", "x".repeat(32));
  expect((await POST(new Request("http://localhost/api/demo-downloads", {method:"POST"}))).status).toBe(401);
});
