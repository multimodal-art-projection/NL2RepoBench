import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import runner
from test_data_service import TestData, test_data_list


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.original_tasks = list(test_data_list)

    def tearDown(self):
        test_data_list[:] = self.original_tasks

    def test_unique_names_across_models_and_reruns(self):
        names = {runner.new_run_id("task", model) for model in ("a/b", "a/b", "x.y")}
        self.assertEqual(len(names), 3)
        self.assertTrue(all("/" not in name and "." not in name for name in names))

    def test_jobs_publish_success_and_failure_independently(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous = Path.cwd()
            os.chdir(tmp)
            try:
                def fail():
                    raise RuntimeError("fixture failure")
                jobs = [runner.Job("ok", "pi", "m", "t", lambda: {"status": "completed"}), runner.Job("bad", "pi", "m", "t", fail)]
                self.assertEqual(len(runner.run_batch(jobs, 2)), 2)
                self.assertEqual(json.loads(Path("result/bad.json").read_text())["status"], "error")
                self.assertIsNone(json.loads(Path("result/ok.json").read_text())["score"])
            finally:
                os.chdir(previous)

    def test_validation_rejects_unknown_tasks_and_unsafe_test_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            prompt = Path(tmp) / "start.md"
            prompt.write_text("fixture")
            test_data_list[:] = [TestData("fixture", 1, [], ["../outside"], "", str(prompt))]
            with self.assertRaisesRegex(ValueError, "Unknown benchmark task"):
                runner.model_tasks({"startPro": [{"moduleName": "m", "proNameList": ["missing"]}]})
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                runner.model_tasks({"startPro": [{"moduleName": "m", "proNameList": ["fixture"]}]})

    def test_evaluation_mutates_only_fresh_copies_and_can_repeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            (workspace / "setup.py").write_text("preserve this")
            (workspace / "answer.py").write_text("answer = 42")
            visited = []

            def evaluator(run_id, target, task, logger):
                path = Path(target)
                visited.append(path)
                (path / "setup.py").unlink()
                return {"status": "success", "pytest_results": {"passed": 1, "total": 1}}

            module = types.ModuleType("openhands.post_processor")
            module.post_process_task = evaluator
            with patch.dict(sys.modules, {"openhands.post_processor": module}):
                for _ in range(2):
                    result = runner.evaluate_result({"task_uuid": "fixture", "status": "completed", "generation_status": "completed", "workspace_path": str(workspace)}, None, True)
                    self.assertEqual(result["score"], 1)
            self.assertNotEqual(*visited)
            self.assertEqual((workspace / "setup.py").read_text(), "preserve this")

    def test_zero_test_score_is_a_completed_benchmark_evaluation(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            (workspace / "answer.py").write_text("answer = 41")
            module = types.ModuleType("openhands.post_processor")
            module.post_process_task = lambda *args: {"status": "success", "pytest_results": {"passed": 0, "failed": 1, "total": 1}}
            with patch.dict(sys.modules, {"openhands.post_processor": module}):
                result = runner.evaluate_result({"task_uuid": "low-score", "status": "completed", "generation_status": "completed", "workspace_path": str(workspace)}, None, True)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["evaluation_status"], "completed")
            self.assertEqual(result["score"], 0)

    def test_failed_or_disabled_generation_is_not_evaluated(self):
        result = runner.evaluate_result({"generation_status": "failed"}, None, True)
        self.assertEqual(result["evaluation_status"], "skipped")
        self.assertIsNone(result["score"])

    def test_diagnostic_evaluation_preserves_incomplete_generation_and_original_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            source = workspace / "answer.py"
            source.write_text("answer = 42")
            module = types.ModuleType("openhands.post_processor")
            calls = []
            def evaluator(run_id, target, task, logger):
                calls.append(target)
                (Path(target) / "answer.py").write_text("modified evaluator copy")
                return {"status": "success", "pytest_results": {"passed": 1, "total": 1}}
            module.post_process_task = evaluator
            original = {"task_uuid": "diagnostic", "status": "failed", "generation_status": "failed", "workspace_path": str(workspace)}
            with patch.dict(sys.modules, {"openhands.post_processor": module}):
                self.assertEqual(runner.evaluate_result(dict(original), None, True)["evaluation_status"], "skipped")
                result = runner.evaluate_result(dict(original), None, True, allow_incomplete=True)
            self.assertEqual(len(calls), 1)
            self.assertEqual(result["evaluation_status"], "completed")
            self.assertEqual(result["evaluation_scope"], "incomplete_generation")
            self.assertEqual(result["generation_status"], "failed")
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["score"], 1)
            self.assertEqual(source.read_text(), "answer = 42")

    def test_evaluation_rejects_symlinks_that_escape_the_generated_repository(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp) / "workspace"
            workspace.mkdir()
            (workspace / "escape").symlink_to(Path(tmp))
            result = runner.evaluate_result({"task_uuid": "x", "status": "completed", "generation_status": "completed", "workspace_path": str(workspace)}, None, True)
            self.assertEqual(result["evaluation_status"], "error")


if __name__ == "__main__":
    unittest.main()
