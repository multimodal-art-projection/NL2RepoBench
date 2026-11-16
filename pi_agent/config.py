"""Validate benchmark settings and stage explicit Pi resources without credentials."""

import hashlib
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

from runner import positive_int, write_json
from .provenance import benchmark_provenance

DEFAULT_IMAGE = "nl2repobench-pi:1.5.2"
PROTOCOLS = {"openai-completions", "openai-responses", "anthropic-messages"}
PACKAGE_DIR = Path(__file__).resolve().parent


def resolve_options(config):
    supplied = config.get("pi", {})
    if not isinstance(supplied, dict):
        raise ValueError("pi must be an object")
    allowed = {"profile", "mock", "image", "teammates", "max_active_teammates", "roles", "extensions",
               "extension_options", "task_timeout_seconds", "max_total_tokens", "max_turns", "max_messages",
               "workflow_validation", "memory", "cpus", "pids_limit", "startup_commands", "batch_file_writes", "compact_write_history", "python_packages", "setup_timeout_seconds", "role_token_limits", "enforce_role_token_limits"}
    if supplied.keys() - allowed:
        raise ValueError(f"Unknown pi settings: {sorted(supplied.keys() - allowed)}")
    profile = supplied.get("profile", "team")
    if profile not in ("single", "team"):
        raise ValueError("pi.profile must be single or team")
    mock = supplied.get("mock", False)
    if type(mock) is not bool:
        raise ValueError("pi.mock must be a boolean")
    batch_files = supplied.get("batch_file_writes", True)
    if type(batch_files) is not bool:
        raise ValueError("pi.batch_file_writes must be a boolean")
    compact = supplied.get("compact_write_history", False)
    if type(compact) is not bool:
        raise ValueError("pi.compact_write_history must be a boolean")
    packages = supplied.get("python_packages", [])
    if not isinstance(packages, list) or not all(isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9_.+!-]+", item) for item in packages):
        raise ValueError("pi.python_packages must contain exact name==version pins")
    result = dict(profile=profile, mock=mock, image=supplied.get("image", DEFAULT_IMAGE), batch_file_writes=batch_files,
                  compact_write_history=compact, python_packages=packages)
    if not isinstance(result["image"], str) or not result["image"].strip():
        raise ValueError("pi.image must be a nonempty image tag")
    for key, default in {"teammates": 2, "max_active_teammates": 2, "task_timeout_seconds": 900,
                         "max_turns": 60, "max_messages": 100,
                         "pids_limit": 512, "setup_timeout_seconds": 120}.items():
        result[key] = positive_int(supplied.get(key, default), f"pi.{key}")
    token_limit = supplied.get("max_total_tokens", 50000)
    if token_limit is not None:
        positive_int(token_limit, "pi.max_total_tokens")
    result["max_total_tokens"] = token_limit
    result["memory"] = supplied.get("memory", "4g")
    result["cpus"] = supplied.get("cpus", 2)
    if not isinstance(result["memory"], str) or not re.fullmatch(r"[1-9][0-9]*[mg]", result["memory"]):
        raise ValueError("pi.memory must be a positive size such as 4g")
    if type(result["cpus"]) not in (int, float) or result["cpus"] <= 0:
        raise ValueError("pi.cpus must be positive")
    validation = supplied.get("workflow_validation", "report")
    if validation not in ("off", "report", "required"):
        raise ValueError("pi.workflow_validation must be off, report, or required")
    result["workflow_validation"] = validation
    if profile == "team" and result["teammates"] < 2:
        raise ValueError("The team profile requires at least two teammates for peer messaging")
    base = Path(config.get("_config_dir", ".")).resolve()
    roles = supplied.get("roles", [
        {"name": "implementer", "prompt_file": str(PACKAGE_DIR / "roles/implementer.md")},
        {"name": "reviewer", "prompt_file": str(PACKAGE_DIR / "roles/reviewer.md"), "start_after": ["implementer"]},
    ])
    if not isinstance(roles, list) or not roles:
        raise ValueError("pi.roles must be a nonempty array")
    result["roles"] = []
    names = set()
    for role in roles:
        if not isinstance(role, dict) or role.keys() - {"name", "prompt_file", "tools", "start_after"}:
            raise ValueError("Each role accepts name, prompt_file, tools, and start_after")
        name = role.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", name) or name in names:
            raise ValueError("Role names must be unique lowercase identifiers")
        names.add(name)
        if not isinstance(role.get("prompt_file"), str) or not role["prompt_file"].strip():
            raise ValueError("Each role requires a prompt_file")
        path = (base / role["prompt_file"]).resolve()
        if not path.is_file():
            raise ValueError(f"Missing role prompt: {path}")
        tools = role.get("tools", ["read", "bash", "edit", "write"])
        if not isinstance(tools, list) or not tools or not all(isinstance(x, str) for x in tools):
            raise ValueError("Role tools must be a nonempty list of tool names")
        dependencies = role.get("start_after", [])
        if not isinstance(dependencies, list) or not all(isinstance(x, str) for x in dependencies) or len(set(dependencies)) != len(dependencies):
            raise ValueError("Role start_after must be a list of unique role names")
        result["roles"].append(dict(name=name, prompt=path.read_text(encoding="utf-8"), tools=tools, start_after=dependencies))
    graph = {role["name"]: role["start_after"] for role in result["roles"]}
    def visit(name, active):
        if name not in graph:
            raise ValueError(f"Unknown start_after role: {name}")
        if name in active:
            raise ValueError("Role start_after dependencies must be acyclic")
        for dependency in graph[name]:
            visit(dependency, active | {name})
    for name in graph:
        visit(name, set())
    if profile == "team" and len(roles) < result["teammates"]:
        raise ValueError("Provide at least one role definition per configured teammate")
    limits = supplied.get("role_token_limits", {})
    if not isinstance(limits, dict) or limits.keys() - (names | {"lead"}):
        raise ValueError("pi.role_token_limits must map configured roles or lead to token limits")
    for name, value in limits.items():
        positive_int(value, f"pi.role_token_limits.{name}")
    if result["max_total_tokens"] is not None and sum(limits.values()) > result["max_total_tokens"]:
        raise ValueError("Role token limits must fit within max_total_tokens")
    enforce = supplied.get("enforce_role_token_limits", False)
    if type(enforce) is not bool:
        raise ValueError("pi.enforce_role_token_limits must be a boolean")
    result["role_token_limits"] = limits
    result["enforce_role_token_limits"] = enforce
    extensions = supplied.get("extensions", [])
    if not isinstance(extensions, list):
        raise ValueError("pi.extensions must be an array")
    result["extensions"] = []
    for ext in extensions:
        if not isinstance(ext, dict) or ext.keys() - {"path", "scope"}:
            raise ValueError("Each extension accepts path and scope")
        if not isinstance(ext.get("path"), str) or not ext["path"].strip():
            raise ValueError("An explicit extension path is required")
        path = (base / ext["path"]).resolve()
        scope = ext.get("scope", "lead")
        if not path.exists() or scope not in ("lead", "members", "all"):
            raise ValueError("Extension path must exist and scope must be lead, members, or all")
        result["extensions"].append(dict(source=str(path), scope=scope))
    options = supplied.get("extension_options", {})
    if not isinstance(options, dict) or not all(isinstance(k, str) and type(v) in (str, bool) for k, v in options.items()):
        raise ValueError("pi.extension_options maps registered flag names to strings or booleans")
    result["extension_options"] = options
    commands = supplied.get("startup_commands", [])
    if not isinstance(commands, list) or not all(isinstance(x, str) and x.startswith("/") for x in commands):
        raise ValueError("pi.startup_commands must be an array of /extension commands")
    result["startup_commands"] = commands
    return result


def resolve_model(entry, mock):
    protocol = entry.get("protocol", "openai-completions")
    if protocol not in PROTOCOLS:
        raise ValueError(f"protocol must be one of {sorted(PROTOCOLS)}")
    model = dict(id=entry["moduleName"], api=protocol,
                 contextWindow=positive_int(entry.get("contextWindow", 131072), "contextWindow"),
                 maxTokens=positive_int(entry.get("maxTokens", 4096), "maxTokens"),
                 reasoning=entry.get("reasoning", False), thinking=entry.get("reasoningEffort", "off"))
    if type(model["reasoning"]) is not bool or model["maxTokens"] > model["contextWindow"]:
        raise ValueError("Invalid reasoning capability or output/context token limits")
    if model["thinking"] not in ("off", "minimal", "low", "medium", "high", "xhigh", "max"):
        raise ValueError("Unsupported reasoningEffort")
    for field in ("compat", "thinkingLevelMap"):
        if field in entry:
            if not isinstance(entry[field], dict):
                raise ValueError(f"{field} must be an object")
            model[field] = entry[field]
    if mock:
        model.update(id="nl2repo-mock", api="openai-completions", baseUrl="mock://local", reasoning=False, thinking="off")
        return model, {"NL2REPO_MODEL_API_KEY": "mock-not-a-secret"}
    base_url = entry.get("baseUrl") or entry.get("base_url") or os.environ.get("NL2REPO_BASE_URL", "")
    parsed = urlparse(base_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Set baseUrl or NL2REPO_BASE_URL to an API URL without embedded credentials or query")
    key_env = entry.get("apiKeyEnv", "NL2REPO_API_KEY")
    if not isinstance(key_env, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key_env):
        raise ValueError("apiKeyEnv must name an environment variable")
    key = os.environ.get(key_env) or entry.get("sk")
    if not isinstance(key, str) or not key.strip():
        raise ValueError(f"Set {key_env} before a real-model run")
    model["baseUrl"] = base_url
    return model, {"NL2REPO_MODEL_API_KEY": key}


def stage_extensions(options, run_dir):
    staged = []
    resource_root = run_dir / "resources"
    resource_root.mkdir()
    for index, ext in enumerate(options["extensions"]):
        source = Path(ext["source"])
        dest = resource_root / str(index)
        if source.is_dir():
            shutil.copytree(source, dest, symlinks=False,
                            ignore=shutil.ignore_patterns(".git", ".env", ".env.*", ".npmrc", "auth.json"))
            entry = dest
        else:
            dest.mkdir()
            entry = dest / source.name
            shutil.copyfile(source, entry)
        hashes = {}
        for item in sorted(dest.rglob("*")):
            if item.is_file():
                hashes[str(item.relative_to(dest))] = hashlib.sha256(item.read_bytes()).hexdigest()
        staged.append(dict(path="/resources/" + str(entry.relative_to(resource_root)), scope=ext["scope"], sha256=hashes))
    return staged


def write_runtime_config(options, model, run_dir):
    extensions = stage_extensions(options, run_dir)
    public = {k: v for k, v in options.items() if k not in {"extensions", "image"}}
    public.update(schema_version=1, workspace="/workspace", home="/pi-home", artifacts="/artifacts",
                  run_id=run_dir.name, model=model, extensions=extensions, benchmark=benchmark_provenance())
    path = run_dir / "runtime.json"
    write_json(path, public)
    return path
