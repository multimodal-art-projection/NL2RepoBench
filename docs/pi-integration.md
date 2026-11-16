# Pi backend and extension teams

The Pi backend runs the public Pi coding-agent SDK in one Docker container per NL2Repo task. The default team has a lead and two persistent teammate sessions, `implementer` and `reviewer`. All three use the selected model and share the task workspace. The lead owns integration; conversations and session files are separate.

The backend also supports a single-agent baseline and explicitly configured Pi extensions. OpenHands remains the default backend for old configuration files. The shared scheduling and Docker lifecycle code is adapted from the [DeepSeek integration](https://github.com/dalongbao/NL2RepoBench/tree/bbd664bdb093351f78b3b2670da9ee53745b27ee).

## WSL setup and build

Use Docker Desktop's WSL 2 engine with Ubuntu integration enabled. Keep the checkout under the Linux filesystem, such as `/home/jon86/projects`, and run the following from the `NL2RepoBench` repository. Docker must work without `sudo`.

This development checkout already has a Python 3.12 virtual environment at `.venv`. For a fresh checkout, create a Python 3.12 environment first, then install `requirements.txt`.

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/build_pi.py
```

The Dockerfile pins the Node.js 24 and Python 3.12 base images by digest. Pi is pinned to `@earendil-works/pi-coding-agent@1.5.2`; `package-lock.json` locks its dependencies. Only explicit runtime source and dependency manifests enter the generation-image build context. Credentials, task tests, host Pi state, and prior runs are excluded.

The runner checks both the Pi version label and runtime content fingerprint before starting jobs. Rebuild the image after changing runtime source or the dependency lockfile. Runtime manifests also record the Python adapter fingerprint, benchmark revision, role and task hashes, image identity, effective tools, extensions, and budget settings.

The supported host execution path is Linux/WSL. Native Windows Node/npm is not required: the build and SDK test scripts use the pinned Linux Node container.

## Mock-only verification

```bash
python scripts/test_pi.py
python scripts/smoke_pi.py --evaluate-fixture
```

The first command runs Python contracts, TypeScript checking, and real Pi SDK sessions against a scripted OpenAI-compatible SSE server. The second command exercises the complete Python-to-Docker path in four configurations: single agent, an external extension with flags and a startup mode command, a lead plus two teammates, and an explicitly uncapped team. It submits generated code to the existing evaluator using a tiny fixture image with one known test.

These are integration checks, not model-quality benchmark scores. Mock usage values are synthetic and incur no model charges. Generation containers in mock mode use Docker's `--network none`; the only model endpoint is a loopback server started inside that container. A supplied external endpoint or real key is ignored in mock mode.

To run the fixture profiles individually without evaluation:

```bash
python main.py --config config.pi.mock.single.json --task-root tests/fixtures
python main.py --config config.pi.mock.team.json --task-root tests/fixtures
```

No real-model tests should be run until an endpoint and credentials are supplied. The real-model example intentionally has a placeholder model and empty endpoint.

## Real model configuration

When real testing is authorized, copy `config.pi.example.json` to the ignored `config.pi.local.json`. Set the exact endpoint model ID and API base URL, or use `NL2REPO_BASE_URL`. Supply credentials in `NL2REPO_API_KEY` or the environment variable named by `apiKeyEnv`. An OpenAI-style key does not by itself identify the endpoint.

Supported configured transports are `openai-completions`, `openai-responses`, and `anthropic-messages`. `openai-completions` means the OpenAI-compatible Chat Completions protocol; the model itself can be served by another provider. The endpoint must support the chosen protocol and tool calls. Configure `reasoning`, `reasoningEffort`, `thinkingLevelMap`, and `compat` according to the actual model/endpoint. Legacy `sk` is accepted but not written into the runtime configuration or result JSON.

If you keep credentials in a Git-ignored local environment file, source it in the same Ubuntu terminal before launching the runner; environment files are not loaded automatically.

Each `startPro` entry selects a model and task names. The `proNameList` values refer to directories under `test_files`. Begin with one selected task and one model. `--skip-evaluation` performs generation only; otherwise `evaluate` defaults to true for compatibility with the original runner.

## Team settings

| Setting under `pi` | Default | Meaning |
|---|---|---|
| `profile` | `team` | `single` or `team`. Single mode starts only the lead. |
| `mock` | `false` | Explicitly select the in-container scripted model. |
| `teammates` | `2` | Number of teammates, excluding the lead. Team mode requires at least two for peer messaging. |
| `max_active_teammates` | `2` | Concurrent member runs; independent of total team size. |
| `roles` | implementer, reviewer | Role name, `prompt_file`, optional built-in `tools`, and optional `start_after` role names. |
| `task_timeout_seconds` | `900` | Task deadline; Docker also enforces an outer deadline. |
| `max_total_tokens` | `50000` | Shared, provider-reported token budget across all actors; explicit null disables token stopping while retaining accounting. |
| `max_turns` | `60` | Shared assistant-response budget across all actors. |
| `batch_file_writes` | `true` | Replace active `write` with multi-file `write_files`; source history stays native unless explicitly compacted. |
| `compact_write_history` | `false` | Opt-in experimental summarization of completed large writes in provider context. Native Pi history is the default. |
| `python_packages` | `[]` | Exact package==version pins installed before model requests in an isolated job target directory. |
| `setup_timeout_seconds` | `120` | Deadline for dependency preparation; failures stop before model calls. |
| `role_token_limits` | `{}` | Optional per-role handoff targets whose sum fits within the shared cap; warnings start at 80%. |
| `enforce_role_token_limits` | `false` | Explicitly enable strict role ceilings. Default targets are advisory; the shared cap remains enforced. |
| `max_messages` | `100` | Maximum queued team messages. |
| `workflow_validation` | `report` | `off`, `report`, or `required`. Required makes incomplete teamwork fail the job. |
| `cpus`, `memory`, `pids_limit` | `2`, `4g`, `512` | Generation-container resource limits. |

`max_pool_size` limits concurrent benchmark jobs. It is separate from teammate concurrency. Start with one benchmark job at a time.

The default reviewer has `start_after: ["implementer"]`. Its persistent session is created immediately, but its first model request is deferred until all spawned implementers report completion and settle. Queued lead follow-ups and implementation handoffs are included in the initial review context. Reviewers never poll an empty workspace. Pi writes native session files only after the first turn; a failed run can therefore record a created but deferred actor with no native file. The verifier identifies these as `deferred_actors`, keeps the run failed/incomplete, and still requires native files for started actors and successful runs. Custom roles may specify their own `start_after` lists (validated as an acyclic graph), or an empty list for independent work. An implementation worker must hand off and finish without waiting for the delayed reviewer to reply; later peer findings can reopen that persistent worker. Failed prerequisites fail dependent workers without model requests.

`wait_agent` accepts a member name or `all`. It blocks until the selected queued/running work settles, bounded by the shared task deadline and cancellation. Legacy `timeout_ms` remains accepted but does not force short status returns. The lead should delegate in a batch, then wait once for `all`. Waiting and scheduler checks consume no model tokens.

Role prompts resolve relative to the configuration file. More than two teammates require enough explicit role definitions. The tested configurations are two teammates with one or two concurrently active members. The SDK does not impose the upstream example's four-worker limit on this extension.

The lead can call `start_team` with all assignments in one action. It creates owned task-board entries, persistent sessions and actual delegation messages. `spawn_teammate` remains available for custom orchestration. A member calls `finish_teammate` to explicitly declare completion, update owned task-board entries, and send its report to the lead and dependent reviewers together. `status: "incomplete"` keeps work incomplete. Dependent workers receive handoffs before their first request. Delivery receipts still require the actual native recipient event; queueing is not counted as delivery. `send_message`, `team_task`, `list_agents` and `wait_agent` remain available for follow-ups. Members do not receive spawn tools. Task write scopes are coordination metadata, not filesystem enforcement.

Messages have separate queued and delivered events. A delivery receipt is recorded only when Pi emits the recipient's custom-message event, showing that the message entered that session's context. It does not prove comprehension. Idle teammates retain their conversation and can handle follow-ups. Waits, final reminders, message draining, and overall execution are bounded.

The built-in file extension provides `write_files` with `files: [{path, content}, ...]`. It writes up to 64 UTF-8 files via Pi's write tool and returns path/byte/hash receipts without echoing source. All paths are checked before the first write; duplicate paths, workspace escapes and symlink traversal are rejected. Runtime I/O failure or cancellation can leave an explicitly reported partial batch. The `write` entry in role tool lists maps to `write_files`; roles without write permission do not gain it. Single-agent mode also supports this tool. Existing custom modes can still manage their own active tools.

When `compact_write_history: true`, the `context` hook summarizes successful large historical `write`/`write_files` call/result pairs as ordinary text receipts in provider context. It removes both sides of each summarized pair, preserving the protocol and avoiding placeholder examples in tool arguments. Full calls and source remain on disk and in native session/normalized traces. Failed, unresolved, unrelated and small calls retain their original IDs/results. The batch writer rejects history omission markers submitted as new file content. This format was corrected after a live model copied the earlier argument markers into new files. Use `read` to retrieve current source when needed. This reduces request size, not accounting: provider-reported input/output token usage is still counted unchanged. `pi.batch_file_writes: false` restores the original write tool. `compact_write_history` defaults to false, so normal runs use Pi's native history and built-in compaction. The summary hook is explicitly experimental and independent of token accounting. Manifests record the effective setting, and `write_history_compacted` events record removed character counts. Mock payload observations verify actual request reduction; synthetic mock tokens do not estimate billing.

## Custom extensions

Add extension files or directories under `pi.extensions`:

```json
{
  "extensions": [
    {"path": "./extensions/my-mode", "scope": "lead"},
    {"path": "./extensions/shared-tools.ts", "scope": "all"}
  ],
  "extension_options": {"my-registered-flag": true},
  "startup_commands": ["/my-mode"]
}
```

Paths resolve relative to the configuration file. Scope is `lead`, `members`, or `all`. Files, directory entry points, and `package.json` manifests declaring `pi.extensions` load through Pi's public resource loader. Use a directory for extensions with relative imports or supporting resources. Dependencies must be prepared before the run:

```bash
python scripts/prepare_pi_extension.py ./extensions/my-mode
```

That helper requires the extension's `package.json` and `package-lock.json`, then runs `npm ci --ignore-scripts` inside the pinned Linux Node container. Stage only the intended extension package; its files and prepared dependencies are copied into the task's read-only `/resources` mount and fingerprinted. Host-provided Pi packages should follow Pi's extension packaging guidance rather than bundling separate Pi runtimes.

`extension_options` supplies values for flags registered with `pi.registerFlag`. `startup_commands` invokes registered noninteractive commands before the task prompt; commands can change the prompt or active tools to implement custom modes. Required load failures, invalid flag values, and capability collisions produce explicit errors. User-level/project auto-discovery, personal skills, MCP configuration, and context-file discovery are disabled; this prevents unrelated local configuration from changing an experiment.

Event handlers, custom tools, registered flags, commands, prompt changes, and shutdown hooks work headlessly. `ctx.hasUI` is false. TUI widgets, editor components, and dialogs require an interactive host and are not implemented here. New/fork/switch/reload commands are explicitly rejected to preserve a fixed benchmark actor identity. Sessions remain persistent across teammate follow-ups; that does not require replacing them.

The bundled team extension uses the public SDK to create members in the same Node process. They have independent conversation contexts, but share process permissions and the generated workspace. Alternative extensions can be selected with `profile: "single"`; the built-in verifier reports team status as not applicable for that profile and does not claim to understand an arbitrary third-party orchestration protocol.

## Artifacts and scoring

Each job gets a unique directory under `workspaces` and an atomic result file under `result`:

```text
workspaces/<run-id>/
  workspace/                  generated source and start.md
  pi-home/                    isolated Pi model/settings state
  resources/                  staged extension resources
  artifacts/manifest.json
  artifacts/lead/              normalized events and native session JSONL
  artifacts/members/<name>/    normalized events and native session JSONL
  artifacts/team-events.jsonl
  artifacts/summary.json
  evaluation/<id>/workspace/   fresh evaluator copy
  stdout.jsonl
  stderr.log
  container.log
result/<run-id>.json
```

The existing evaluator removes packaging/test paths from its input. It now operates on a fresh copy, preserving the generated repository and artifacts. Scoring rules and the original 104 task definitions are unchanged.

Results distinguish `generation_status`, `runtime_generation_status`, `extension_status`, `team.status`, and `evaluation_status`. A completed evaluation can have zero passed tests. Skipped evaluation has null scores. Workflow compliance remains visible independently of functional score, including when `workflow_validation` requires a successful team run.

With workflow validation `off`, team status is `not_checked`; trace integrity is still checked. Single-agent runs report `not_applicable`.

The trace reader checks schema versions, duplicate IDs, LF framing, native-session presence, team creation, delivered lead/member and peer messages, completed tasks, and final reports. It retains raw events for inspecting collaboration quality. Usage is counted from finalized messages once per actor, with auxiliary compaction usage tracked separately when exposed. Unknown prices remain null. Shared token limits are enforced at response boundaries, so in-flight concurrent responses can overshoot a limit; they are not a guaranteed billing cap.

Re-evaluate a saved completed generation without calling a model:

```bash
python only_test.py --run-id <run-id>
# For the deterministic fixture:
python only_test.py --run-id <fixture-run-id> --task-root tests/fixtures
```

Re-evaluation publishes a separate result referring to `source_run_id` and uses another fresh workspace copy.

## Validation scope

Mock checks cover the actual Pi SDK/tool loop, headless extension loading/options/commands/hooks, packaged local dependencies, three persistent sessions, peer messaging, concurrency limits and spawn races, retries, worker errors, early lead completion, token limits, timeouts, malformed traces, Docker lifecycle handling, and evaluator copies. The Docker smoke checks use a deterministic fixture, not a claim about Qwen/DeepSeek performance on NL2Repo.

Live endpoint compatibility, real-model scores, larger teams, and a complete OpenHands container run remain separate validation work. OpenHands dispatch and configuration compatibility are covered by automated contracts.

## Dependency preparation and token reservations

Provide only dependencies declared by the public task requirements, such as `python_packages: ["attrs==25.4.0"]` for jsonlines. A bounded pip subprocess installs them into the job's Pi home and sets PYTHONPATH for agent tools. The model credential is removed from the installer environment. setup.json and setup.log retain the outcome; preparation errors stop before model requests. The generation workspace and held-out evaluator remain separate.

Role allocations are optional handoff targets, not extra tokens. For a 1M shared cap, a configuration can assign lead=150000, implementer=650000 and reviewer=200000. Actors sharing a role share its reservation. A warning is injected after 80% usage so a worker can hand off or report incomplete honestly. By default, these targets are advisory, so an actor may continue toward a truthful handoff using the remaining shared allowance. Set enforce_role_token_limits=true to opt into hard per-role stops. The initial 1M pilot exposed how strict role stops could strand review despite unused shared capacity, so strict mode is no longer the default. Enforced limits are checked after responses and can overshoot. Failed prerequisites never fabricate completion. The lead and each worker use a smaller builtin tool set; explicitly configured external extension tools remain available.

The OpenHands adapter launches the standard OpenHands 0.56 headless agent with a default 7200-second deadline and no equivalent shared-token ceiling. The Pi team profile adds independent contexts, team verification and optional role budgets. A 100k cumulative input/output allowance across three sessions is not comparable to a 100k context window or an unconstrained single-agent run. Report model quality separately from these harness differences.

Diagnostic tests for a saved failed generation are explicit and preserve failure status:

```bash
python only_test.py --run-id <run-id> --allow-incomplete
```

The separate result refers to source_run_id and records evaluation_scope=incomplete_generation. A diagnostic score is a test result for saved source, not a completed team-run claim. Default re-evaluation still requires completed generation, and all evaluation operates on fresh copies.

## Completion-focused one-repository validation

A generated repository can have failing tests while the agent and benchmark complete normally. The implementation pass creates all required files and performs a small import/syntax check, the reviewer reports findings in one pass, and the lead collects both reports. Repository tests then measure quality separately. Neither a failed smoke assertion nor a low pytest score automatically makes a normally completed generation/team lifecycle fail. Missing source or an unsubmitted required report remains a workflow failure.

For an explicitly authorized uncapped single task, use max_total_tokens=null, role_token_limits={}, enforce_role_token_limits=false, one selected task and max_pool_size=1. The run still has its task timeout, cancellation and shared-turn safeguard. Keep this in a dedicated local config when uncapped execution was authorized for only one run; ordinary configs retain their prior cap. Per-response maxTokens and contextWindow are separate model settings.

Workers get two bounded reminders if they try to settle without finish_teammate. A worker still missing its report then fails explicitly and releases dependent waits, instead of leaving a reviewer blocked until the task deadline.

The smoke script additionally exercises an uncapped-team profile through the Python-to-Docker-to-evaluator path with external model networking disabled.
