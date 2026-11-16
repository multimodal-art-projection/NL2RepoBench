"""Evaluate a saved run without model requests; incomplete sources require explicit opt-in."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from main import ROOT
from runner import evaluate_result, new_run_id, write_json


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--allow-incomplete", action="store_true", help="Diagnostically test saved failed/incomplete source while preserving its failure status")
    parser.add_argument("--task-root", default=str(ROOT / "test_files"))
    args = parser.parse_args(argv)
    task_root = Path(args.task_root).expanduser().resolve()
    if Path(args.run_id).name != args.run_id:
        parser.error("run-id must be a result identifier, not a path")
    original = json.loads((ROOT / "result" / f"{args.run_id}.json").read_text(encoding="utf-8"))
    if original.get("generation_status") != "completed" and not args.allow_incomplete:
        parser.error("Re-evaluation requires a completed generation; use --allow-incomplete for diagnostic testing")
    import os
    import test_data_service
    os.chdir(ROOT)
    test_data_service.read_all_test_data(str(task_root))
    task = next((item for item in test_data_service.test_data_list if item.proName == original["pro_name"]), None)
    if task is None:
        parser.error("Original task not found in task-root")
    result = dict(original, task_uuid=new_run_id(original["pro_name"], "reevaluation"), source_run_id=args.run_id,
                  status=original.get("status", "failed"), saved_at=datetime.now(timezone.utc).isoformat())
    evaluate_result(result, task, True, allow_incomplete=args.allow_incomplete)
    output = ROOT / "result" / f"{result['task_uuid']}.json"
    write_json(output, result)
    print(output)
    return 0 if result["evaluation_status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
