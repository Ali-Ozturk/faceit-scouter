from typing import Any


def first_present(row: dict[str, Any], names: list[str]) -> Any:
    for name in names:
        value = row.get(name)
        if value is not None:
            return value
    return None
