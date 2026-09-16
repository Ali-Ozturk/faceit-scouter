const FACEIT_ROOM_SEGMENT = /\/(?:[a-z]{2}\/)?(?:cs2|csgo)\/room\/([^/?#]+)/i;

export function extractFaceitMatchId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "faceit.com" && !parsed.hostname.endsWith(".faceit.com")) return null;
    const roomMatch = parsed.pathname.match(FACEIT_ROOM_SEGMENT);
    if (roomMatch?.[1]) return decodeURIComponent(roomMatch[1]);
    const queryMatch = parsed.searchParams.get("matchId") ?? parsed.searchParams.get("match_id");
    return queryMatch?.trim() || null;
  } catch {
    return null;
  }
}

export function createFaceitMatchroomUrl(matchId: string) {
  return `https://www.faceit.com/en/cs2/room/${encodeURIComponent(matchId)}`;
}
