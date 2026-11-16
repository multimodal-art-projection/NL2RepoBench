import json
import tempfile
import unittest
from pathlib import Path

from pi_agent.session_summary import summarize_run


class SummaryTests(unittest.TestCase):
    def make_fixture(self, root):
        lead = root / "lead"
        lead.mkdir()
        native = lead / "session.jsonl"
        native.write_text('{"type":"session","version":3}\n')
        event = dict(schema_version=1, run_id="r", event_id="one", actor_id="lead", type="actor_created", data={"text": "Unicode separator \u2028 stays inside JSON"})
        trace = lead / "events.jsonl"
        trace.write_text(json.dumps(event, ensure_ascii=False) + "\n")
        summary = dict(schema_version=1, runtime_generation_status="completed", extension_status="loaded", team={"status": "not_applicable", "errors": []}, usage={}, actors=[{"id": "lead", "session_file": str(native)}])
        (root / "summary.json").write_text(json.dumps(summary))
        return trace, native

    def test_valid_lf_framing_accepts_unicode_separators(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_fixture(root)
            self.assertEqual(summarize_run(root, {"profile": "single"})["runtime_generation_status"], "completed")

    def test_duplicate_and_truncated_traces_fail(self):
        for damage in ("duplicate", "truncate", "schema", "native"):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                trace, native = self.make_fixture(root)
                if damage == "duplicate":
                    trace.write_text(trace.read_text() * 2)
                elif damage == "truncate":
                    trace.write_text(trace.read_text().rstrip("\n"))
                elif damage == "schema":
                    trace.write_text(trace.read_text().replace('"schema_version": 1', '"schema_version": 9'))
                else:
                    native.write_text('{"type":"session","version":3}')
                self.assertEqual(summarize_run(root, {"profile": "single"})["runtime_generation_status"], "failed")

    def test_failed_run_can_defer_a_member_before_its_first_native_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_fixture(root)
            member = root / "members/reviewer"
            member.mkdir(parents=True)
            event = dict(schema_version=1, run_id="r", event_id="review-created", actor_id="reviewer", type="actor_created", data={})
            trace = member / "events.jsonl"
            trace.write_text(json.dumps(event) + "\n")
            created = dict(event, event_id="member-created", actor_id="lead", type="member_created", data={"id": "reviewer"})
            (root / "team-events.jsonl").write_text(json.dumps(created) + "\n")
            path = root / "summary.json"
            summary = json.loads(path.read_text())
            summary.update(runtime_generation_status="failed", team={"status": "incomplete", "errors": []})
            summary["actors"].append({"id": "reviewer", "session_file": str(member / "session.jsonl"), "last_stop_reason": None})
            path.write_text(json.dumps(summary))
            options = {"profile": "team", "teammates": 2}
            result = summarize_run(root, options)
            self.assertEqual(result["runtime_generation_status"], "failed")
            self.assertEqual(result["deferred_actors"], ["reviewer"])
            self.assertNotIn("trace_errors", result)
            self.assertEqual(result["team"]["status"], "incomplete")
            summary["runtime_generation_status"] = "completed"
            path.write_text(json.dumps(summary))
            self.assertIn("trace_errors", summarize_run(root, options))
            summary["runtime_generation_status"] = "failed"
            path.write_text(json.dumps(summary))
            trace.write_text(trace.read_text() + json.dumps(dict(event, event_id="review-started", type="agent_start")) + "\n")
            self.assertIn("trace_errors", summarize_run(root, options))

    def test_missing_runtime_summary_is_an_explicit_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = summarize_run(tmp, {"profile": "team", "teammates": 2})
            self.assertEqual(result["runtime_generation_status"], "error")
            self.assertEqual(result["team"]["status"], "incomplete")


if __name__ == "__main__":
    unittest.main()
