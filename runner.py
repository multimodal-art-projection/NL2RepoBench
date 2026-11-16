"""Backend-independent scheduling and results, adapted from dalongbao's integration."""

import concurrent.futures
import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Callable

from test_data_service import test_data_list


@dataclass
class Job:
    task_uuid: str
    backend: str
    module_name: str
    pro_name: str
    run: Callable[[], dict]


def positive_int(value, field):
    if type(value) is not int or value < 1:
        raise ValueError(f"{field} must be a positive integer")
    return value


def evaluation_enabled(config):
    value = config.get("evaluate", True)
    if type(value) is not bool:
        raise ValueError("evaluate must be a boolean")
    return value


def new_run_id(project, model):
    prefix = re.sub(r"[^a-z0-9-]+", "-", f"{project}-{model}".lower()).strip("-")
    return f"{prefix[:64]}-{uuid.uuid4().hex}"


def model_tasks(config):
    tasks = {item.proName: item for item in test_data_list}
    entries = config.get("startPro")
    if not isinstance(entries, list) or not entries:
        raise ValueError("startPro must contain model configurations")
    selected = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Each startPro item must be an object")
        model = entry.get("moduleName")
        if not isinstance(model, str) or not model.strip():
            raise ValueError("moduleName must be a nonempty model ID")
        names = entry.get("proNameList")
        if not isinstance(names, list) or not names:
            raise ValueError("proNameList must be a nonempty list")
        for name in names:
            if not isinstance(name, str) or name not in tasks:
                raise ValueError(f"Unknown benchmark task: {name!r}")
            task = tasks[name]
            if not task.md or not Path(task.md).is_file():
                raise ValueError(f"Missing instructions for {name}")
            for filename in task.pyTestFileList:
                path = PurePosixPath(filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError(f"Unsafe evaluator test path for {name}")
            selected.append((entry, model, task))
    return selected


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def evaluate_result(result, test_data, enabled, *, allow_incomplete=False):
    result.update(evaluation_status="skipped", test_score=None, score=None)
    incomplete = result.get("generation_status") != "completed"
    if not enabled or (incomplete and not allow_incomplete):
        return result
    result["evaluation_scope"] = "incomplete_generation" if incomplete else "completed_generation"
    workspace = Path(result["workspace_path"])
    evaluation_workspace = workspace.parent / "evaluation" / uuid.uuid4().hex / "workspace"
    try:
        for path in workspace.rglob("*"):
            if path.is_symlink() and not path.resolve().is_relative_to(workspace.resolve()):
                raise ValueError("Generated repository contains a symlink outside its workspace")
        from openhands.post_processor import post_process_task
        shutil.copytree(workspace, evaluation_workspace, symlinks=True)
        from logging_config import get_logger
        evaluation = post_process_task(result["task_uuid"], str(evaluation_workspace), test_data, get_logger(__name__))
        result.update(post_process_result=evaluation, evaluation_workspace_path=str(evaluation_workspace))
        if evaluation["status"] == "success":
            counts = evaluation["pytest_results"]
            result.update(evaluation_status="completed", test_score=counts["passed"], score=counts["passed"])
        else:
            result.update(evaluation_status="error", status="failed")
    except Exception as exc:
        result.update(evaluation_status="error", status="failed", evaluation_error=str(exc))
    return result


def run_batch(jobs, max_workers):
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        pending = {executor.submit(job.run): job for job in jobs}
        for future in concurrent.futures.as_completed(pending):
            job = pending[future]
            try:
                result = future.result()
            except Exception as exc:
                result = {"status": "error", "generation_status": "error", "error": str(exc)}
            result.update(task_uuid=job.task_uuid, backend=job.backend, module_name=job.module_name,
                          pro_name=job.pro_name, saved_at=datetime.now(timezone.utc).isoformat())
            result.setdefault("evaluation_status", "skipped")
            result.setdefault("test_score", None)
            result.setdefault("score", None)
            write_json(Path("result") / f"{job.task_uuid}.json", result)
            results.append(result)
            print(f"{job.backend} / {job.pro_name}: {result['status']} (score={result['score']})", flush=True)
    return results
