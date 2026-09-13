import importlib.util
import json
import asyncio
import sys
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_container_queue_timing_excludes_host_observation(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/processor'))
        try:
            batch_spec = importlib.util.spec_from_file_location('batch', Path(__file__).with_name('batch.py'))
            batch = importlib.util.module_from_spec(batch_spec)
            batch_spec.loader.exec_module(batch)
        finally:
            sys.path.pop(0)

        async def exercise():
            timings = {}
            queue = batch.TimedQueue(timings, 100.0)
            queue.put_nowait(Path('test.dem'))
            with patch.object(batch.time, 'perf_counter', side_effect=[102.0, 105.0]):
                await queue.get()
                queue.task_done()
            await queue.join()
            self.assertEqual(timings['test.dem'], {'queue_seconds': 2.0, 'completion_seconds': 5.0,
                                                  'service_seconds': 3.0})
        asyncio.run(exercise())

    def test_resource_peak_is_sum_at_same_sample(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'resources.jsonl'
            containers = '\n'.join(json.dumps({'MemUsage': memory, 'CPUPerc': cpu})
                                   for memory, cpu in [('1GiB / 8GiB', '120%'), ('512MiB / 8GiB', '30%')])
            path.write_text(json.dumps({'containers': containers, 'work_bytes': 42}) + '\n')
            result = runner.resource_summary(path)
            self.assertEqual(result['sampled_combined_peak_memory_bytes'], 1536 * 1024**2)
            self.assertEqual(result['sampled_combined_peak_cpu_percent'], 150)
            self.assertEqual(result['sampled_peak_work_bytes'], 42)

    def test_duplicate_inputs_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'one.dem').write_bytes(b'demo')
            (folder / 'two.dem.zst').write_bytes(b'demo')
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                runner.manifest(folder)

    def test_manifest_ignores_partial_files(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / 'one.dem').write_bytes(b'demo')
            (folder / 'two.dem.part').write_bytes(b'partial')
            rows = runner.manifest(folder)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['bytes'], 4)
            self.assertEqual(len(rows[0]['sha256']), 64)

    def test_failed_or_missing_imports_cannot_pass(self):
        data = {'imports': [{'status': 'COMPLETED'}, {'status': 'DUPLICATE'}],
                'stages': [], 'database_bytes': 10}
        self.assertFalse(runner.summarize(data, 60, 2)['valid'])
        self.assertEqual(runner.summarize(data, 60, 2)['demos_per_minute'], 1)
        data['imports'] = [{'status': 'COMPLETED'}]
        self.assertFalse(runner.summarize(data, 60, 2)['valid'])

    def test_commit_inclusive_stage_kept_separate(self):
        data = {'imports': [{'status': 'COMPLETED'}], 'database_bytes': 10,
                'stages': [{'source': 'processor', 'stage': 'persist', 'duration_ms': 100},
                           {'source': 'persist', 'stage': 'total', 'duration_ms': 80}]}
        result = runner.summarize(data, 60, 1)
        self.assertTrue(result['valid'])
        self.assertEqual(result['stage_ms']['processor.persist']['median'], 100)
        self.assertEqual(result['stage_ms']['persist.total']['median'], 80)


if __name__ == '__main__':
    unittest.main()
