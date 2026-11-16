import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pi_agent.config import resolve_model, resolve_options
from pi_agent.runner import _run_task, start_pi
from test_data_service import test_data_list


class PiRunnerTests(unittest.TestCase):
    def test_mock_container_has_no_network_no_socket_and_only_explicit_mounts(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = Path.cwd()
            os.chdir(tmp)
            try:
                prompt = Path(tmp) / "task.md"
                prompt.write_text("fixture")
                options = resolve_options({"pi": {"mock": True}})
                model, env = resolve_model({"moduleName": "mock"}, True)
                with patch("pi_agent.runner.run_batch_container", return_value={"generation_status": "completed"}) as run, patch("pi_agent.runner.summarize_run", return_value={"runtime_generation_status": "completed", "team": {"status": "completed"}}):
                    result = _run_task("fixture", SimpleNamespace(md=prompt), model, env, options, {"id": "image-id"}, False)
                args = run.call_args.args[0]
                self.assertEqual(args[args.index("--network") + 1], "none")
                self.assertNotIn("docker.sock", " ".join(args))
                self.assertNotIn("test_files", " ".join(args))
                self.assertIn("NL2REPO_MODEL_API_KEY", args)
                self.assertNotIn("mock-not-a-secret", args)
                self.assertEqual(result["status"], "completed")
                self.assertIsNone(result["score"])
                runtime = json.loads(Path(result["config_path"]).read_text())
                self.assertEqual(runtime["teammates"], 2)
            finally:
                os.chdir(original)

    def test_every_model_is_validated_before_any_docker_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            prompt = Path(tmp) / "start.md"
            prompt.write_text("fixture")
            original = list(test_data_list)
            test_data_list[:] = [SimpleNamespace(proName="fixture", md=prompt, pyTestFileList=[])]
            try:
                config = {"startPro": [{"moduleName": "model", "baseUrl": "https://model.invalid/v1", "sk": "test", "proNameList": ["fixture"]}, {"moduleName": "other", "proNameList": ["fixture"]}]}
                with patch("pi_agent.runner._image_info") as image, self.assertRaises(ValueError):
                    start_pi(config)
                image.assert_not_called()
            finally:
                test_data_list[:] = original


if __name__ == "__main__":
    unittest.main()
