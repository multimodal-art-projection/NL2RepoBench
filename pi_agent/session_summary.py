"""Validate versioned Pi traces independently of the runtime's final answer."""

import json
from pathlib import Path


def summarize_run(directory, options):
    directory = Path(directory)
    errors = []
    try:
        summary = json.loads((directory / "summary.json").read_text(encoding="utf-8"))
        if summary.get("schema_version") != 1:
            raise ValueError("Unsupported summary schema")
    except (OSError, ValueError) as exc:
        return dict(runtime_generation_status="error", extension_status="error",
                    team={"status": "incomplete", "errors": [f"Missing or invalid runtime summary: {exc}"]}, usage={})
    seen, run_ids, actors, started = set(), set(), set(), set()
    deferred = []
    members, tasks, queued, delivered, finished = {}, {}, {}, set(), set()
    paths = [directory / "lead/events.jsonl", *directory.glob("members/*/events.jsonl")]
    if options["profile"] == "team":
        paths.append(directory / "team-events.jsonl")
    for path in paths:
        try:
            raw = path.read_text(encoding="utf-8")
            if raw and not raw.endswith("\n"):
                raise ValueError("Truncated JSONL tail")
            for line in raw.split("\n")[:-1]:
                frame = json.loads(line)
                if frame.get("schema_version") != 1 or not frame.get("event_id") or not frame.get("run_id"):
                    raise ValueError("Unsupported or malformed trace frame")
                if frame["event_id"] in seen:
                    raise ValueError("Duplicate trace event ID")
                seen.add(frame["event_id"])
                run_ids.add(frame["run_id"])
                actor = frame["actor_id"]
                kind, data = frame["type"], frame.get("data", {})
                if kind == "actor_created":
                    actors.add(actor)
                elif kind == "agent_start":
                    started.add(actor)
                elif kind == "member_created":
                    members[data["id"]] = data
                elif kind == "task_updated":
                    tasks[data["id"]] = data
                elif kind == "message_queued":
                    if data["id"] in queued:
                        raise ValueError("Duplicate team message ID")
                    queued[data["id"]] = data
                elif kind == "message_delivered":
                    delivered.add((data["message_id"], actor))
                elif kind == "member_finished":
                    finished.add(data["id"])
        except (OSError, ValueError, KeyError, TypeError) as exc:
            errors.append(f"Invalid trace {path.name}: {exc}")
    if len(run_ids) != 1:
        errors.append("Expected exactly one trace run ID")
    if not summary.get("actors") or "lead" not in {item.get("id") for item in summary.get("actors", [])}:
        errors.append("Missing lead actor in runtime summary")
    for actor in summary.get("actors", []):
        # Paths inside the container map to the supplied host artifact root.
        native = actor.get("session_file")
        if native and native.startswith("/artifacts/"):
            native = str(directory / native.removeprefix("/artifacts/"))
        native_path = Path(native) if native else None
        # Pi persists a native file lazily on the first turn. An intentionally
        # deferred member may never get a turn when an earlier worker exhausts
        # the budget. Keep that generation failed, without claiming trace damage.
        if (summary.get("runtime_generation_status") != "completed" and actor["id"] in actors & members.keys()
                and actor["id"] not in started and not actor.get("last_stop_reason")
                and native_path and not native_path.exists()
                and native_path.resolve().is_relative_to(directory.resolve())):
            deferred.append(actor["id"])
            continue
        if (actor["id"] not in actors or not native_path or not native_path.is_file()
                or not native_path.resolve().is_relative_to(directory.resolve())):
            errors.append(f"Missing actor trace/session: {actor['id']}")
        else:
            try:
                raw = native_path.read_text(encoding="utf-8")
                entries = raw.split("\n")
                header = json.loads(entries[0])
                if not raw.endswith("\n") or header.get("type") != "session" or header.get("version") != 3:
                    raise ValueError("Unsupported or truncated native Pi session")
                for line in entries[1:-1]:
                    json.loads(line)
            except (OSError, ValueError) as exc:
                errors.append(f"Invalid native session for {actor['id']}: {exc}")
    team = summary.get("team", {"status": "incomplete", "errors": []})
    team_errors = list(team.get("errors", []))
    if options["profile"] == "team" and options.get("workflow_validation") != "off":
        if len(members) != options["teammates"] or not set(members).issubset(actors & finished):
            team_errors.append("Missing created, traced, or finished teammates")
        edges = set()
        for message_id, recipient in delivered:
            item = queued.get(message_id)
            if not item or item["target"] != recipient:
                team_errors.append("Delivery receipt does not match a queued recipient")
            else:
                edges.add((item["sender"], recipient))
        if any((message_id, item["target"]) not in delivered for message_id, item in queued.items()):
            team_errors.append("Undelivered team messages remain")
        for member in members:
            if ("lead", member) not in edges or (member, "lead") not in edges:
                team_errors.append(f"Missing bidirectional exchange for {member}")
        if not any(sender in members and target in members and sender != target for sender, target in edges):
            team_errors.append("No delivered peer message")
        if not tasks or any(task["status"] != "completed" for task in tasks.values()):
            team_errors.append("Task board is empty or unfinished")
        team_errors.extend(errors)
        team = dict(team, status="incomplete" if team_errors else "completed", errors=list(dict.fromkeys(team_errors)))
    elif errors:
        team = dict(team, errors=errors)
    result = {key: summary[key] for key in ("runtime_generation_status", "extension_status", "usage", "actors", "budget_error", "mock_requests", "setup", "role_budget_errors") if key in summary}
    result.update(team=team, manifest_path=str(directory / "manifest.json"), session_logs_path=str(directory))
    if deferred:
        result["deferred_actors"] = deferred
    if summary.get("error"):
        result["runtime_error"] = summary["error"]
    if errors:
        result.update(trace_errors=errors, runtime_generation_status="failed")
    return result
