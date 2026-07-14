import { describe, expect, it } from "vitest";
import { createFaceitMatchroomUrl, extractFaceitMatchId } from "./match-url";

describe("FACEIT match URL helpers", () => {
  it("extracts a CS2 matchroom ID", () => {
    expect(extractFaceitMatchId("https://www.faceit.com/en/cs2/room/1-abc-def")).toBe("1-abc-def");
  });

  it("extracts URL-encoded room IDs", () => {
    expect(extractFaceitMatchId("https://www.faceit.com/en/cs2/room/abc%2Fdef")).toBe("abc/def");
  });

  it("rejects non-FACEIT URLs", () => {
    expect(extractFaceitMatchId("https://example.com/en/cs2/room/1-abc")).toBeNull();
  });

  it("creates matchroom links", () => {
    expect(createFaceitMatchroomUrl("1-abc")).toBe("https://www.faceit.com/en/cs2/room/1-abc");
  });
});
