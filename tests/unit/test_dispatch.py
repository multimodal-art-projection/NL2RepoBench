import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class DispatchTests(unittest.TestCase):
    def test_legacy_config_still_dispatches_to_openhands(self):
        previous = Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "config.json"
                path.write_text(json.dumps({"startPro": []}))
                with patch("test_data_service.read_all_test_data"), patch("openhands.openhands_app.start_openhands", return_value=[]) as start:
                    self.assertEqual(main.main(["--config", str(path)]), 0)
                    start.assert_called_once()
        finally:
            os.chdir(previous)

    def test_mock_and_generation_only_flags_reach_pi(self):
        previous = Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "config.json"
                path.write_text(json.dumps({"backend": "pi", "startPro": []}))
                with patch("test_data_service.read_all_test_data"), patch("pi_agent.runner.start_pi", return_value=[]) as start:
                    self.assertEqual(main.main(["--config", str(path), "--mock", "--skip-evaluation"]), 0)
                    config = start.call_args.args[0]
                    self.assertTrue(config["pi"]["mock"])
                    self.assertFalse(config["evaluate"])
                    self.assertEqual(config["_config_dir"], tmp)
        finally:
            os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
