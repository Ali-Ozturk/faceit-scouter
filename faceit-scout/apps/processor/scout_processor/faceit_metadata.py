from datetime import UTC, datetime
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


FACEIT_BASE_URL = "https://open.faceit.com/data/v4"
PLAYED_AT_KEYS = (
    "started_at",
    "startedAt",
    "finished_at",
    "finishedAt",
    "played_at",
    "playedAt",
    "configured_at",
    "created_at",
    "createdAt",
)


class FaceitMetadataError(Exception):
    pass


def fetch_match_played_at(match_id: str, token: str, timeout_seconds: float = 10) -> datetime | None:
    request = Request(
        f"{FACEIT_BASE_URL}/matches/{quote(match_id)}",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise FaceitMetadataError(str(exc)) from exc
    return extract_played_at_from_match_payload(payload)


def extract_played_at_from_match_payload(payload: object) -> datetime | None:
    if not isinstance(payload, dict):
        return None
    for key in PLAYED_AT_KEYS:
        parsed = parse_datetime_value(payload.get(key))
        if parsed:
            return parsed
    return None


def parse_datetime_value(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value <= 0:
            return None
        timestamp = value / 1000 if value > 10_000_000_000 else value
        try:
            parsed = datetime.fromtimestamp(timestamp, UTC)
        except (OverflowError, OSError, ValueError):
            return None
        return parsed if 2000 <= parsed.year <= 2100 else None
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None
