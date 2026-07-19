import type { FaceitApi, FaceitHistoryEntry } from "./discovery";

const FACEIT_BASE_URL = "https://open.faceit.com/data/v4";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  async resolvePlayerId(playerIdOrNickname: string) {
    const trimmed = playerIdOrNickname.trim();
    if (UUID_PATTERN.test(trimmed)) return trimmed;

    const response = await this.request(`/players?nickname=${encodeURIComponent(trimmed)}&game=cs2`);
    const playerId = stringValue(response.player_id ?? response.playerId);
    if (!playerId) {
      throw new Error(`Could not resolve FACEIT player nickname "${trimmed}".`);
    }
    return playerId;
  }

  async getPlayerHistory(playerId: string, limit: number): Promise<FaceitHistoryEntry[]> {
    const response = await this.request(`/players/${encodeURIComponent(playerId)}/history?game=cs2&limit=${limit}`);
    const items = Array.isArray(response.items) ? response.items : [];
    return items.map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        matchId: stringValue(record.match_id ?? record.matchId ?? record.id) ?? "",
        playedAt: dateValue(record.started_at ?? record.startedAt ?? record.finished_at ?? record.finishedAt ?? record.played_at ?? record.playedAt ?? record.created_at ?? record.createdAt),
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
