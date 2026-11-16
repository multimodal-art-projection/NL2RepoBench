import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pi_agent.config import resolve_model, resolve_options, write_runtime_config


class PiConfigTests(unittest.TestCase):
    def test_default_is_two_teammates_and_one_job_is_configurable(self):
        options = resolve_options({})
        self.assertEqual(options["teammates"], 2)
        self.assertTrue(options["batch_file_writes"])
        self.assertFalse(options["compact_write_history"])
        self.assertEqual(options["python_packages"], [])
        self.assertFalse(options["enforce_role_token_limits"])
        self.assertFalse(resolve_options({"pi": {"batch_file_writes": False}})["batch_file_writes"])
        self.assertEqual([r["name"] for r in options["roles"]], ["implementer", "reviewer"])
        self.assertEqual(options["roles"][1]["start_after"], ["implementer"])

    def test_role_dependencies_are_configurable_and_acyclic(self):
        roles = [{"name": "builder", "prompt_file": "pi_agent/roles/implementer.md"},
                 {"name": "checker", "prompt_file": "pi_agent/roles/reviewer.md", "start_after": ["builder"]}]
        options = resolve_options({"pi": {"roles": roles}})
        self.assertEqual(options["roles"][1]["start_after"], ["builder"])
        for dependency in (["missing"], ["checker"], ["builder", "builder"], "builder"):
            invalid = [roles[0], dict(roles[1], start_after=dependency)]
            with self.subTest(dependency=dependency), self.assertRaises(ValueError):
                resolve_options({"pi": {"roles": invalid}})
        with self.assertRaisesRegex(ValueError, "acyclic"):
            resolve_options({"pi": {"roles": [dict(roles[0], start_after=["checker"]), roles[1]]}})

    def test_setup_and_role_budget_configuration(self):
        options = resolve_options({"pi": {"python_packages": ["attrs==25.4.0"], "role_token_limits": {"lead": 10000, "implementer": 30000, "reviewer": 10000}}})
        self.assertEqual(options["python_packages"], ["attrs==25.4.0"])
        self.assertEqual(sum(options["role_token_limits"].values()), 50000)
        for supplied in ({"python_packages": ["attrs"]}, {"python_packages": ["--index-url=x"]},
                         {"role_token_limits": {"unknown": 10}}, {"role_token_limits": {"lead": True}},
                         {"role_token_limits": {"implementer": 50001}}, {"compact_write_history": "true"},
                         {"setup_timeout_seconds": 0}, {"enforce_role_token_limits": "true"}):
            with self.subTest(supplied=supplied), self.assertRaises(ValueError):
                resolve_options({"pi": supplied})

    def test_uncapped_tokens_are_explicit_and_usage_caps_remain_default(self):
        self.assertEqual(resolve_options({})["max_total_tokens"], 50000)
        self.assertIsNone(resolve_options({"pi": {"max_total_tokens": None}})["max_total_tokens"])
        for value in (False, 0, -1, "unlimited"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                resolve_options({"pi": {"max_total_tokens": value}})

    def test_mock_replaces_external_endpoint_and_needs_no_key(self):
        model, env = resolve_model({"moduleName": "external", "baseUrl": "https://never-contact.invalid", "sk": "sensitive"}, True)
        self.assertEqual(model["baseUrl"], "mock://local")
        self.assertEqual(env["NL2REPO_MODEL_API_KEY"], "mock-not-a-secret")
        self.assertNotIn("sensitive", json.dumps(model))

    def test_key_is_kept_out_of_generated_configuration(self):
        with patch.dict(os.environ, {"NL2REPO_API_KEY": "test-sensitive-key"}):
            model, env = resolve_model({"moduleName": "model", "baseUrl": "https://model.invalid/v1"}, False)
        self.assertEqual(env["NL2REPO_MODEL_API_KEY"], "test-sensitive-key")
        self.assertNotIn("test-sensitive-key", json.dumps(model))
        with tempfile.TemporaryDirectory() as tmp:
            path = write_runtime_config(resolve_options({}), model, Path(tmp))
            self.assertNotIn("test-sensitive-key", path.read_text())

    def test_real_model_requires_credentials_and_valid_url(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "NL2REPO_API_KEY"):
                resolve_model({"moduleName": "model", "baseUrl": "https://model.invalid/v1"}, False)
        for url in ("file:///etc/passwd", "https://secret@model.invalid", "https://model.invalid?key=secret"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                resolve_model({"moduleName": "model", "baseUrl": url}, False)

    def test_invalid_limits_and_unknown_options_fail_preflight(self):
        for field, value in [("teammates", 1), ("max_active_teammates", True), ("max_turns", 0), ("typo", 2), ("mock", "true"), ("batch_file_writes", "true")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                resolve_options({"pi": {field: value}})

    def test_extension_paths_resolve_relative_to_config_and_are_fingerprinted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "extension.ts").write_text("export default () => {};\n")
            options = resolve_options({"_config_dir": tmp, "pi": {"extensions": [{"path": "extension.ts", "scope": "all"}]}})
            run_dir = root / "run"
            run_dir.mkdir()
            config = json.loads(write_runtime_config(options, {"id": "mock"}, run_dir).read_text())
            entry = config["extensions"][0]
            self.assertEqual(entry["path"], "/resources/0/extension.ts")
            self.assertEqual(len(entry["sha256"]["extension.ts"]), 64)

    def test_invalid_extensions_and_flags_are_rejected(self):
        for supplied in ({"extensions": [{}]}, {"extensions": [{"path": "not-present.ts"}]},
                         {"extension_options": {"flag": 42}}, {"startup_commands": ["not-a-command"]}):
            with self.subTest(supplied=supplied), self.assertRaises(ValueError):
                resolve_options({"pi": supplied})


if __name__ == "__main__":
    unittest.main()
