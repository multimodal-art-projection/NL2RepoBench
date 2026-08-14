import importlib
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


def import_docker_service_without_runtime_dependency():
    """The command-construction tests do not require a running Docker daemon."""
    fake_module = types.ModuleType("python_on_whales")
    fake_module.DockerClient = type("DockerClient", (), {})
    fake_module.Image = type("Image", (), {})
    fake_module.Container = type("Container", (), {})
    with patch.dict(sys.modules, {"python_on_whales": fake_module}):
        return importlib.import_module("docker_self.docker_service")


docker_service = import_docker_service_without_runtime_dependency()
REPO_ROOT = Path(__file__).resolve().parents[1]


class ExecuteCommandRegressionTest(unittest.TestCase):
    def test_string_command_is_executed_by_a_shell(self):
        client = Mock()
        client.container.execute.return_value = "ok"
        command = "touch README.md && pip install -e ."

        with patch.object(docker_service, "create_docker_client", return_value=client):
            exit_code, output = docker_service.execute_command_in_container(
                docker_service.DockerHostInfo("local"),
                "container-id",
                command,
                workdir="/workspace",
            )

        self.assertEqual((exit_code, output), (0, "ok"))
        client.container.execute.assert_called_once_with(
            "container-id",
            ["/bin/sh", "-lc", command],
            user=None,
            workdir="/workspace",
        )

    def test_explicit_argv_list_remains_direct_execution(self):
        client = Mock()
        client.container.execute.return_value = "ok"
        command = ["pytest", "tests"]

        with patch.object(docker_service, "create_docker_client", return_value=client):
            docker_service.execute_command_in_container(
                docker_service.DockerHostInfo("local"),
                "container-id",
                command,
            )

        client.container.execute.assert_called_once_with(
            "container-id",
            command,
            user=None,
            workdir=None,
        )

    def test_parse_installation_is_ordered(self):
        commands = json.loads(
            (REPO_ROOT / "test_files" / "parse" / "test_commands.json").read_text()
        )
        self.assertIn("pip install -e . && pip install -r", commands[0])
        self.assertNotIn(" & ", commands[0])

    def test_binaryalert_region_applies_to_pytest_process(self):
        commands = json.loads(
            (REPO_ROOT / "test_files" / "binaryalert" / "test_commands.json").read_text()
        )
        self.assertEqual(
            commands,
            ["AWS_DEFAULT_REGION=us-east-1 pytest --continue-on-collection-errors tests"],
        )


if __name__ == "__main__":
    unittest.main()
