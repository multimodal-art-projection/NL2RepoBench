"""Bounded Docker jobs with retained exit status and diagnostics.

Adapted from dalongbao/NL2RepoBench at bbd664b.
"""

import json
import subprocess
import time
from pathlib import Path


def docker_command(args, **kwargs):
    return subprocess.run(["docker", *args], check=True, text=True, **kwargs)


def run_batch_container(create_args, name, directory, timeout_seconds, env=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    stdout_path, stderr_path = directory / "stdout.jsonl", directory / "stderr.log"
    lifecycle_path = directory / "container.log"
    result = dict(container_name=name, exit_code=None, generation_status="error",
                  stdout_path=str(stdout_path), stderr_path=str(stderr_path), container_log_path=str(lifecycle_path))
    started = time.monotonic()
    with lifecycle_path.open("w", encoding="utf-8") as lifecycle:
        try:
            created = docker_command(["create", "--name", name, *create_args], env=env,
                                     stdout=subprocess.PIPE, stderr=lifecycle, timeout=120)
            container_id = created.stdout.strip()
            result["container_id"] = container_id
            with stdout_path.open("w", encoding="utf-8") as out, stderr_path.open("w", encoding="utf-8") as err:
                try:
                    attached = subprocess.run(["docker", "start", "--attach", container_id],
                                              stdout=out, stderr=err, timeout=timeout_seconds)
                    result["attach_exit_code"] = attached.returncode
                except subprocess.TimeoutExpired:
                    result.update(generation_status="timeout", error=f"Generation exceeded {timeout_seconds} seconds")
                    docker_command(["stop", "--time", "10", container_id], stdout=lifecycle, stderr=lifecycle, timeout=25)
            state = json.loads(docker_command(["inspect", container_id], stdout=subprocess.PIPE,
                                             stderr=lifecycle, timeout=30).stdout)[0]["State"]
            result.update(exit_code=state.get("ExitCode"), oom_killed=bool(state.get("OOMKilled")))
            if result["generation_status"] != "timeout":
                completed = (state["Status"] == "exited" and state["ExitCode"] == 0
                             and not state.get("OOMKilled") and not state.get("Error")
                             and result.get("attach_exit_code") == 0)
                result["generation_status"] = "completed" if completed else "failed"
            if state.get("OOMKilled"):
                result["error"] = "Container was killed by the out-of-memory killer"
            elif state.get("Error"):
                result["error"] = state["Error"]
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            result["error"] = f"Container operation failed ({type(exc).__name__}); see container.log"
        finally:
            try:
                removed = subprocess.run(["docker", "rm", "--force", name], stdout=lifecycle, stderr=lifecycle, timeout=30)
                if removed.returncode:
                    result["cleanup_error"] = "Container removal failed; see container.log"
            except (OSError, subprocess.SubprocessError) as exc:
                result["cleanup_error"] = f"Container removal failed ({type(exc).__name__})"
            result["duration_seconds"] = round(time.monotonic() - started, 3)
    return result
