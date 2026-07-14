import type { FaceitApi, FaceitHistoryEntry } from "./discovery";

const FACEIT_BASE_URL = "https://open.faceit.com/data/v4";

export class FaceitHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FaceitHttpError";
  }
}

export class FaceitHttpClient implements FaceitApi {
  constructor(private readonly token: string) {}

  async getMatch(matchId: string) {
    return this.request(`/matches/${encodeURIComponent(matchId)}`);
  }

  async getPlayerHistory(playerId: string, limit: number): Promise<FaceitHistoryEntry[]> {
    const response = await this.request(`/players/${encodeURIComponent(playerId)}/history?game=cs2&limit=${limit}`);
    const items = Array.isArray(response.items) ? response.items : [];
    return items.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        matchId: stringValue(record.match_id ?? record.matchId ?? record.id) ?? "",
        playedAt: dateValue(record.started_at ?? record.finished_at ?? record.played_at),
      };
    }).filter((entry) => entry.matchId);
  }

  private async request(path: string) {
    const response = await fetch(`${FACEIT_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new FaceitHttpError(`FACEIT API request failed with ${response.status}`, response.status);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }
}

export function createFaceitClientFromEnv() {
  const token = process.env.FACEIT_API_TOKEN;
  if (!token) {
    throw new Error("FACEIT_API_TOKEN is not configured.");
  }
  return new FaceitHttpClient(token);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value < 10_000_000_000 ? value * 1000 : value);
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }
  return null;
}
