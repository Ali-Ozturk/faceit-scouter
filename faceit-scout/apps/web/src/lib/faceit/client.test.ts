import { afterEach, describe, expect, it, vi } from "vitest";
import { FaceitHttpClient } from "./client";

describe("FaceitHttpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses UUID player identifiers without resolving them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const client = new FaceitHttpClient("token");
    const playerId = "df455f38-6eff-46eb-bba2-a6b397f025cd";

    await expect(client.resolvePlayerId(playerId)).resolves.toBe(playerId);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves player nicknames to player IDs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ player_id: "df455f38-6eff-46eb-bba2-a6b397f025cd" }),
    } as Response);
    const client = new FaceitHttpClient("token");

    await expect(client.resolvePlayerId(" Nanoon ")).resolves.toBe("df455f38-6eff-46eb-bba2-a6b397f025cd");
    expect(fetch).toHaveBeenCalledWith(
      "https://open.faceit.com/data/v4/players?nickname=Nanoon&game=cs2",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("fetches player history with a bounded time window and pagination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ match_id: "match", started_at: 1_720_000_000 }] }),
    } as Response);
    const client = new FaceitHttpClient("token");

    await expect(client.getPlayerHistory("player", {
      from: new Date("2026-04-22T00:00:00Z"),
      to: new Date("2026-07-22T00:00:00Z"),
      offset: 100,
      limit: 100,
    })).resolves.toEqual([{ matchId: "match", playedAt: new Date("2024-07-03T09:46:40.000Z") }]);

    expect(fetch).toHaveBeenCalledWith(
      "https://open.faceit.com/data/v4/players/player/history?game=cs2&from=1776816000&to=1784678400&offset=100&limit=100",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });
});
