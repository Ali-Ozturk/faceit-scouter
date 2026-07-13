import hashlib


def exact_lineup_fingerprint(steam_ids: list[str]) -> str:
    source = "|".join(sorted(steam_ids))
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def lineup_display_name(nicknames: list[str], limit: int = 96) -> str:
    name = ", ".join(nicknames)
    return name if len(name) <= limit else f"{name[: limit - 1]}…"
