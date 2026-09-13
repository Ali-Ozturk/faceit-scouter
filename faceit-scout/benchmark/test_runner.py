import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
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
