import asyncio
from pathlib import Path


IGNORED_SUFFIXES = (".crdownload", ".tmp", ".part")
SUPPORTED_SUFFIXES = (".dem", ".dem.zst", ".dem.gz")


def is_supported_demo(path: Path) -> bool:
    name = path.name
    if name.startswith(".") or name.endswith(IGNORED_SUFFIXES):
        return False
    return name.endswith(SUPPORTED_SUFFIXES)


async def wait_until_stable(
    path: Path,
    interval_seconds: float,
    required_checks: int,
    timeout_seconds: float,
) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    stable_checks = 0
    previous: tuple[int, float] | None = None

    while asyncio.get_running_loop().time() < deadline:
        if not path.exists() or path.stat().st_size <= 0:
            stable_checks = 0
            await asyncio.sleep(interval_seconds)
            continue
        stat = path.stat()
        current = (stat.st_size, stat.st_mtime)
        stable_checks = stable_checks + 1 if current == previous else 0
        previous = current
        if stable_checks >= required_checks:
            return True
        await asyncio.sleep(interval_seconds)

    return False
