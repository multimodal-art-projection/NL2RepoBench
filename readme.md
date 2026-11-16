# NL2RepoBench

NL2RepoBench evaluates coding agents on **104 tasks**, each requiring a complete, runnable repository to be generated from a natural-language specification. Each task has an isolated Docker evaluation image containing the original repository tests.

This fork integrates the **Pi coding agent**, including headless ExtensionAPI support and a lead with two persistent teammates, alongside the existing OpenHands backend. Both use the same task definitions and evaluator; the scoring rules are unchanged.

## Supported backends

| Backend | Runtime | Agent setup |
|---|---|---|
| Pi | `@earendil-works/pi-coding-agent@1.5.2` | Single agent, or a lead with configurable teammates and extensions |
| OpenHands | OpenHands 0.56 | Existing headless CodeAct agent; this adapter exposes no Pi-style team setting |

Select a backend with `backend` in the JSON configuration or the `--backend` CLI option. Configurations without a backend continue to use OpenHands.

## Requirements

- Linux, or Ubuntu under WSL 2. The validated Windows setup uses Docker Desktop with its Linux engine and Ubuntu integration enabled.
- Python 3.12 and Docker accessible from the same Linux/WSL user without `sudo`.
- For WSL, keep the checkout in the Linux filesystem, such as `~/projects/NL2RepoBench`.
- Network access for initial image/dependency downloads. Live Pi runs also need a model endpoint that supports the selected protocol and tool calls.

Node.js and npm run inside pinned Docker images for the Pi build and tests; a host Node.js installation is unnecessary. Run the commands below from the repository root in Linux/WSL.

## Pi setup and mock verification

Create a virtual environment and build the Pi image:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/build_pi.py
```

Verify the integration without a model endpoint or key:

```bash
python scripts/test_pi.py
python scripts/smoke_pi.py --evaluate-fixture
```

The test script runs Python contracts, TypeScript checking, and real Pi SDK sessions against a local scripted model. The smoke script exercises single-agent, external-extension, team, and uncapped-team profiles through Docker and the existing evaluator, using a tiny fixture. Mock generation containers use `--network none`; these checks make no real-model requests.

To run just the team generation fixture:

```bash
python main.py --config config.pi.mock.team.json --task-root tests/fixtures
```

Rebuild the Pi image after changing runtime source or dependencies. The runner checks its version and source fingerprint before generation.

## Run one repository with Pi

Start with a local configuration and supply credentials through the environment:

```bash
cp config.pi.example.json config.pi.local.json
chmod 600 config.pi.local.json
export NL2REPO_API_KEY="YOUR_API_KEY"
export NL2REPO_BASE_URL="https://YOUR_ENDPOINT/v1"
```

Edit `config.pi.local.json` with the endpoint's exact model ID, context window, and per-response output limit. A nonempty `baseUrl` in the model entry takes precedence over `NL2REPO_BASE_URL`. `apiKeyEnv` names the environment variable holding the key. Local `.env` files are not loaded automatically; source one in the launching shell if you use it.

The checked-in example is a limited pilot: generation only, a 50,000-token shared cap, 60 responses, and a 900-second deadline. A full repository can require substantially more usage. The following **one-repository team example disables total-token stopping**, enables evaluation, and retains time and response safeguards. Replace `null` with a positive integer to impose a shared cumulative token ceiling.

```json
{
  "backend": "pi",
  "evaluate": true,
  "max_pool_size": 1,
  "pi": {
    "profile": "team",
    "mock": false,
    "teammates": 2,
    "max_active_teammates": 2,
    "task_timeout_seconds": 3600,
    "max_total_tokens": null,
    "max_turns": 200,
    "workflow_validation": "required",
    "python_packages": ["attrs==25.4.0", "pytest==8.4.2"]
  },
  "startPro": [
    {
      "moduleName": "YOUR_EXACT_MODEL_ID",
      "protocol": "openai-completions",
      "baseUrl": "",
      "apiKeyEnv": "NL2REPO_API_KEY",
      "contextWindow": 131072,
      "maxTokens": 4096,
      "reasoning": false,
      "proNameList": ["jsonlines"]
    }
  ]
}
```

The `contextWindow` and `maxTokens` values above are examples; set them for your model and endpoint. `python_packages` installs exact dependency pins before model calls; these pins were used for the `jsonlines` validation and can be changed for other tasks.

Launch the selected task:

```bash
python main.py --config config.pi.local.json
```

This creates **one repository**, runs the agent workflow, and then evaluates its output. For generation only, set `evaluate` to `false` or pass `--skip-evaluation`.

Supported Pi transports are `openai-completions` (OpenAI-compatible Chat Completions), `openai-responses`, and `anthropic-messages`. Configure reasoning and compatibility options for the endpoint in use; see the [Pi integration guide](docs/pi-integration.md).

### Configuration controls

| Setting | Meaning |
|---|---|
| `startPro[].proNameList` | Selected task directories under `test_files`; `jsonlines` selects one repository |
| `max_pool_size` | Concurrent benchmark jobs, independent of teammate count |
| `pi.profile` | `team` for the lead and teammates, or `single` for the lead alone |
| `pi.teammates` | Teammates excluding the lead; team mode requires at least two |
| `pi.max_active_teammates` | Maximum concurrently active teammates |
| `pi.max_total_tokens` | Shared cumulative usage across all actors and responses; `null` disables token stopping |
| `pi.max_turns` / `pi.task_timeout_seconds` | Shared response limit and task deadline |
| `pi.workflow_validation` | `off`, `report`, or `required`; required validation rejects incomplete teamwork |
| `startPro[].contextWindow` / `maxTokens` | Per-request model context and output settings, separate from cumulative usage |

Token ceilings are checked at response boundaries; in-flight responses can overshoot. Native Pi history is the default, and batched file writes are enabled. Role token allocations are optional and advisory unless strict enforcement is explicitly enabled. See the guide for role definitions, dependencies, resource limits, and budget settings.

## Teams and ExtensionAPI

The default team consists of a **lead, implementer, and reviewer** using the selected model. They share the generated repository while retaining separate persistent conversations and session files. The implementer hands off its work before the reviewer begins; the lead collects both reports. The bundled extension provides delegation, peer messaging, a task board, blocking waits, and explicit teammate completion. Required workflow validation checks the recorded reports, tasks, sessions, and message delivery separately from code quality.

Use `pi.profile: "single"` for a single-agent baseline. Custom roles and larger teams can be configured; the validated team size is two teammates plus the lead.

Custom extensions can register tools, event hooks, flags, and noninteractive commands through Pi's public ExtensionAPI. For example, add these fields to the `pi` object, replacing the extension path and options with your own:

```json
{
  "extensions": [{"path": "./extensions/my-mode", "scope": "all"}],
  "extension_options": {"my-registered-flag": true},
  "startup_commands": ["/my-mode"]
}
```

Extension paths resolve relative to the configuration file; scopes are `lead`, `members`, or `all`. Dependency-bearing extensions can be prepared with `python scripts/prepare_pi_extension.py ./extensions/my-mode`. The host is headless: interactive TUI widgets and dialogs are unavailable, and session-replacement commands are unsupported. See [extension loading and supported capabilities](docs/pi-integration.md#custom-extensions) for packaging details.

## Results and saved repositories

```text
test_files/<task>/                 Task specification and evaluation metadata
workspaces/<run-id>/workspace/     Generated repository and start.md
workspaces/<run-id>/artifacts/     Pi manifest, usage, team events, and sessions
workspaces/<run-id>/evaluation/    Separate evaluator copies and test logs
result/<run-id>.json               Aggregated result for one job
```

Each job receives a unique run ID. Pi results distinguish generation, extension loading, team workflow, and evaluation status. **Normal completion does not require all repository tests to pass.** `score` and `test_score` contain the number of passed tests, not a percentage; `post_process_result.pytest_results` contains the counts used to calculate the pass rate. Skipped evaluation has a null score.

The evaluator operates on a fresh copy so the original generated repository is preserved. Re-evaluate a completed saved run without calling a model, replacing `YOUR_RUN_ID` with its result identifier:

```bash
python only_test.py --run-id YOUR_RUN_ID
```

Diagnostic evaluation of failed/incomplete generation requires `--allow-incomplete` and preserves its failure status. The local Pi config (`config.pi.local.json`), `.env` files, generated repositories, logs, and results are ignored by Git.

## OpenHands compatibility

Existing `config.json` model/task configurations remain supported:

```bash
python main.py --backend openhands --config config.json
```

The adapter uses `template/config.template.toml` for its agent and sandbox settings. It fills the benchmark model group from `moduleName`, `baseUrl`/`base_url`, and `apiKeyEnv` or legacy `sk`. Use environment variables for credentials where possible.

The original image references use `docker.all-hands.dev`. In the recorded comparison that hostname did not resolve, so the official OpenHands 0.56 images were obtained from GHCR:

- `ghcr.io/all-hands-ai/openhands:0.56`
- `ghcr.io/all-hands-ai/runtime:0.56-nikolaik`

For the standard adapter, changing registries requires updating `APP_IMAGE` and `RUNTIME_IMAGE` in `openhands/openhands_app.py`. The [comparison report](docs/openhands-pi-jsonlines-comparison.md) records the immutable digests and isolated driver used to match model limits, retain trajectories, and disable browser tools. The standard OpenHands template otherwise enables browsing; live Pi has shell network access but no dedicated browser tool by default.

## Verified integration results

Validation includes **28 Python contracts and 33 Pi SDK mock tests**, TypeScript checking, and all four complete Docker mock evaluator profiles passing at 1/1.

A full `jsonlines` repository task also completed with `Qwen/Qwen3.5-397B-A17B-FP8`, using a 262,144-token context setting and an 8,192-token response limit. The Pi run used a lead and two teammates, completed its independent workflow verification, and ran the official repository tests. A subsequent single-agent OpenHands comparison used the same model endpoint, specification, evaluator base, and network policy, with no total-token ceiling in either run.

| Measurement | Pi team | OpenHands single agent |
|---|---:|---:|
| Generation and evaluation | completed | completed |
| Official tests passed | 17/27 (62.96%) | 17/27 (62.96%) |
| Failed / collection errors | 10 / 0 | 10 / 0 |
| Reported total tokens | 2,187,575 | 5,386,665 |
| Generation time | 18.34 minutes | 16.23 minutes |

These are one-task validation results, not full-benchmark scores. Prompts, tools, generation images, and agent counts differ. Generation times exclude image downloads and evaluation; reported token usage is not a billing estimate.

- [Pi setup, configuration, extensions, and artifacts](docs/pi-integration.md)
- [Completed Pi repository validation](docs/pi-one-repository-validation.md)
- [Pi versus OpenHands comparison and test differences](docs/openhands-pi-jsonlines-comparison.md)
- [Mock validation and development history](docs/pi-validation.md)
