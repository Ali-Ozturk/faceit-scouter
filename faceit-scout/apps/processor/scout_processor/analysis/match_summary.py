import hashlib


def internal_match_fingerprint(parts: list[str | None]) -> str:
    source = "|".join(part or "" for part in parts)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()
