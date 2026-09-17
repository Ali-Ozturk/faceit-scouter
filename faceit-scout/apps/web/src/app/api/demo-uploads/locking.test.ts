import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
import { GET, DELETE } from "./[id]/route";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it.each(["PROCESSING", "COMPLETED", "UPLOADING"])("responds promptly when a worker owns the job lock (%s)", async status => {
  vi.stubEnv("SCOUT_IMPORT_KEY", "x".repeat(32));
  const execute = vi.fn().mockResolvedValue([{ locked: false }]);
  const where = vi.fn().mockResolvedValue([{ status }]);
  mocks.transaction.mockImplementation(async callback => callback({ execute,
    select: () => ({ from: () => ({ where }) }) }));
  const response = await GET(new Request("http://localhost/upload", { headers: { Authorization: "Bearer " + "x".repeat(32) } }),
    { params: Promise.resolve({ id: "a2345678-1234-4234-8234-123456789abc" }) });
  expect(response.status).toBe(status === "UPLOADING" ? 503 : 200);
  if (response.ok) expect(await response.json()).toEqual({ complete: true, status });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("does not cancel a job whose lock is owned by a worker", async () => {
  vi.stubEnv("SCOUT_IMPORT_KEY", "x".repeat(32));
  mocks.transaction.mockImplementation(async callback => callback({
    execute: vi.fn().mockResolvedValue([{ locked: false }]),
    select: () => ({ from: () => ({ where: async () => [{ status: "PROCESSING" }] }) }),
  }));
  const response = await DELETE(new Request("http://localhost/upload", { headers: { Authorization: "Bearer " + "x".repeat(32) } }),
    { params: Promise.resolve({ id: "a2345678-1234-4234-8234-123456789abc" }) });
  expect(response.status).toBe(503);
});
