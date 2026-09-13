"""Compare old/new parser in the same image/storage; verify full output equality."""
import cProfile
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import pstats
import statistics
import time

from scout_processor.ingestion.decompression import decompress_if_needed
from scout_processor.parsing.demo_parser import DemoParser


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument('--repeats', type=int, default=3)
    arguments.add_argument('--limit', type=int, default=0, help='Zero compares all inputs')
    arguments.add_argument('--report', default='comparison.json')
    args = arguments.parse_args()
    if args.repeats < 1:
        arguments.error('--repeats must be positive')
    spec = importlib.util.spec_from_file_location('baseline_parser', '/comparison/baseline_parser.py')
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    output = []
    Path('/data/decompressed').mkdir(parents=True, exist_ok=True)
    sources = sorted(Path('/inputs').glob('*.dem.zst'))
    if args.limit:
        sources = sources[:args.limit]
    if not sources:
        raise ValueError('No compressed demos found')
    for source in sources:
        demo = decompress_if_needed(source, Path('/data/decompressed'))
        checksums = {}
        for repeat in range(args.repeats + 1):
            # First pair is warm-up, then alternate order to reduce order bias.
            pair = [('baseline', baseline.DemoParser), ('optimized', DemoParser)]
            if repeat % 2:
                pair.reverse()
            for label, cls in pair:
                started = time.perf_counter()
                parsed = cls().parse(demo, 'comparison-checksum')
                seconds = time.perf_counter() - started
                payload = parsed.model_dump(mode='json')
                digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
                checksums.setdefault(label, digest)
                if digest != checksums[label]:
                    raise AssertionError(f'Non-deterministic {label} output: {source.name}')
                row = {'file': source.name, 'parser': label, 'repeat': repeat, 'seconds': seconds, 'digest': digest}
                output.append(row)
                print(json.dumps(row), flush=True)
        if checksums['baseline'] != checksums['optimized']:
            raise AssertionError(f'Output mismatch: {source.name}')
    # Separate profiled run: never mix profiler overhead into speed comparison.
    profiler = cProfile.Profile()
    profiler.runcall(DemoParser().parse, demo, 'comparison-checksum')
    with Path('/comparison/profile.txt').open('w') as stream:
        pstats.Stats(profiler, stream=stream).sort_stats('cumulative').print_stats(45)
    report = {'runs': output, 'median_seconds': {
        label: statistics.median(r['seconds'] for r in output if r['parser']==label and r['repeat']>0)
        for label in ('baseline', 'optimized')}, 'outputs_equal': True}
    (Path('/comparison') / Path(args.report).name).write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
