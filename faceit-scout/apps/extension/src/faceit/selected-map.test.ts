import { describe, expect, it } from "vitest";
import { chooseSelectedMap } from "./selected-map";
describe("map voting", () => {
  it("waits when several veto maps are visible", () => expect(chooseSelectedMap([], ["Inferno", "Mirage"])).toBeNull());
  it("accepts a single final selected map despite veto history", () => expect(chooseSelectedMap(["de_inferno"], ["Mirage", "Inferno"])).toBe("de_inferno"));
  it("waits for ambiguous or missing selections", () => {
    expect(chooseSelectedMap(["Inferno", "Mirage"], [])).toBeNull();
    expect(chooseSelectedMap([], [])).toBeNull();
  });
  it("deduplicates labels", () => expect(chooseSelectedMap([], ["Dust 2", "de_dust2"])).toBe("de_dust2"));
});
