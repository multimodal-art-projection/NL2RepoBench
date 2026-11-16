"""Run a selected NL2Repo generation backend and the shared evaluator."""

import argparse
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(ROOT / "config.json"))
    parser.add_argument("--backend", choices=("openhands", "pi"))
    parser.add_argument("--skip-evaluation", action="store_true")
    parser.add_argument("--mock", action="store_true", help="Use only the local scripted model")
    parser.add_argument("--task-root", help="Task metadata directory; defaults to test_files")
    args = parser.parse_args(argv)
    config_path = Path(args.config).expanduser().resolve()
    with config_path.open(encoding="utf-8") as stream:
        config = json.load(stream)
    if not isinstance(config, dict):
        parser.error("Configuration must be a JSON object")
    config["_config_dir"] = str(config_path.parent)
    if args.skip_evaluation:
        config["evaluate"] = False
    backend = args.backend or config.get("backend", "openhands")
    if backend not in ("openhands", "pi"):
        parser.error(f"Unknown backend: {backend}")
    if args.mock:
        if backend != "pi":
            parser.error("--mock requires the pi backend")
        config.setdefault("pi", {})["mock"] = True
    task_root = Path(args.task_root).expanduser().resolve() if args.task_root else ROOT / "test_files"
    os.chdir(ROOT)
    import test_data_service
    test_data_service.read_all_test_data(str(task_root))
    if backend == "pi":
        from pi_agent.runner import start_pi
        results = start_pi(config)
    else:
        from openhands.openhands_app import start_openhands
        results = start_openhands(config)
    failed = sum(item["status"] != "completed" for item in results)
    print(f"{backend}: {len(results)} tasks, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
