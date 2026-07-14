import { describe, expect, it } from "vitest";
import { isExtensionMessage } from "./messages";

describe("message validation", () => {
  it("accepts known messages", () => {
    expect(isExtensionMessage({ type: "GET_SETTINGS" })).toBe(true);
  });

  it("rejects unknown messages", () => {
    expect(isExtensionMessage({ type: "NOPE" })).toBe(false);
    expect(isExtensionMessage(null)).toBe(false);
  });
});
