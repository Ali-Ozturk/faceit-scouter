import { describe, expect, it } from "vitest";
import { mapRadars, toRadarPoint } from "./round-path-preview";

const expectedRadars = {
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5 },
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4 },
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_train: { posX: -2477, posY: 2392, scale: 4.7 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4 },
};

describe("round path radar translation", () => {
  it("uses the fork-aligned radar data for every bundled map", () => {
    expect(mapRadars).toMatchObject(expectedRadars);
  });

  it("matches the known Ancient radar transform", () => {
    expect(toRadarPoint({ x: -2953, y: 2164 }, { imageSize: 1024, posX: -2953, posY: 2164, scale: 5 })).toEqual({ x: 0, y: 0 });
    expect(toRadarPoint({ x: 2167, y: -2956 }, { imageSize: 1024, posX: -2953, posY: 2164, scale: 5 })).toEqual({ x: 1024, y: 1024 });
  });

  it("matches the known Inferno radar transform", () => {
    expect(toRadarPoint({ x: -2087, y: 3870 }, { imageSize: 1024, posX: -2087, posY: 3870, scale: 4.9 })).toEqual({ x: 0, y: 0 });
    expectPointCloseTo(
      toRadarPoint({ x: 2930.6, y: -1147.6 }, { imageSize: 1024, posX: -2087, posY: 3870, scale: 4.9 }),
      { x: 1024, y: 1024 },
    );
  });
});

function expectPointCloseTo(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}
