import { describe, expect, it } from "vitest";
import { isImportStatus } from "./imports";

describe("isImportStatus", () => {
  it("accepts known statuses", () => {
    expect(isImportStatus("COMPLETED")).toBe(true);
  });

  it("rejects unknown statuses", () => {
    expect(isImportStatus("BROKEN")).toBe(false);
  });
});
