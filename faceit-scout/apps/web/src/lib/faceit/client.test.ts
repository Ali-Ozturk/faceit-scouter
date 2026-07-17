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
});
