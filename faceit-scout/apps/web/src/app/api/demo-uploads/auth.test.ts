import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ db: {} }));
import { GET, POST } from "./route";
import { GET as resume, PUT, DELETE } from "./[id]/route";
afterEach(() => vi.unstubAllEnvs());
it.each(["", "short", "x".repeat(32)])("fails closed for every upload operation (configured key %s)", async key => {
  vi.stubEnv("SCOUT_IMPORT_KEY",key);
  for (const action of [GET, POST, resume, PUT, DELETE]) {
    const result = await action(new Request("http://localhost/api/demo-uploads", {headers:{Authorization:"Bearer wrong"}}), {params:Promise.resolve({id:"not-even-valid"})});
    expect(result.status).toBe(401);
  }
});
