import shutil
import errno
from pathlib import Path


def safe_destination(directory: Path, file_name: str) -> Path:
    destination = (directory / Path(file_name).name).resolve()
    if destination.parent != directory.resolve():
        raise ValueError("Refusing path traversal destination")
    if destination.exists():
        stem = destination.stem
        suffix = "".join(destination.suffixes)
        destination = directory / f"{stem}-{id(destination)}{suffix}"
    return destination


def claim_file(source: Path, processing_directory: Path) -> Path:
    destination = safe_destination(processing_directory, source.name)
    try:
        return source.replace(destination)
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise
        return Path(shutil.move(str(source), str(destination)))


def move_file(source: Path, directory: Path) -> Path:
    destination = safe_destination(directory, source.name)
    return Path(shutil.move(str(source), str(destination)))
