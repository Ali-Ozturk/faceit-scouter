"""Compare streaming buffer sizes on native volume storage, verifying output hashes."""
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import time
import zstandard

root = Path('/data/decompress-bench')
root.mkdir(exist_ok=True, parents=True)
rows = []
for input_path in sorted(Path('/inputs').glob('*.dem.zst'))[:3]:
    source = root / input_path.name
    shutil.copyfile(input_path, source)
    expected = None
    for repeat in range(4):
        sizes = [0, 1024*1024, 4*1024*1024]
        sizes = sizes[repeat % 3:] + sizes[:repeat % 3]
        for size in sizes:
            destination = root / 'output.dem'
            started = time.perf_counter()
            with source.open('rb') as compressed, destination.open('wb') as output:
                options = {'read_size': size, 'write_size': size} if size else {}
                zstandard.ZstdDecompressor().copy_stream(compressed, output, **options)
            elapsed = time.perf_counter() - started
            with destination.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            expected = expected or digest
            assert expected == digest
            row = {'file': source.name, 'buffer_bytes': size, 'repeat': repeat, 'seconds': elapsed}
            rows.append(row)
            print(json.dumps(row), flush=True)
            destination.unlink()
    source.unlink()
Path('/comparison/decompression.json').write_text(json.dumps({'runs': rows, 'outputs_equal': True,
    'median_seconds': {str(size): statistics.median(r['seconds'] for r in rows if r['repeat']>0 and r['buffer_bytes']==size)
                       for size in (0, 1024*1024, 4*1024*1024)}}, indent=2))
