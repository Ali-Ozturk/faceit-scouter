"""Copy immutable inputs into the volume before timing; verify manifest checksums."""
import hashlib
import json
from pathlib import Path
import shutil

for name in ('incoming', 'processing', 'completed', 'failed', 'decompressed', 'temporary'):
    Path('/data', name).mkdir(parents=True, exist_ok=True)
manifest = json.loads(Path('/report/inputs.json').read_text())
for item in manifest:
    destination = Path('/data/incoming') / item['name']
    temporary = destination.with_suffix(destination.suffix + '.part')
    shutil.copyfile(Path('/inputs') / item['name'], temporary)
    with temporary.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != item['sha256']:
        raise RuntimeError(f'Input changed during staging: {item["name"]}')
    temporary.replace(destination)
