# OpenHands versus Pi: one jsonlines task

Both runs completed normally and both scored **17/27 (62.96%)** on the official evaluator: 17 passed, 10 failed, zero collection errors. The matching score does not mean identical implementations: 15 tests passed in both, eight failed in both, and four tests split between them.

This validates normal generation and evaluation with both backends. It is one trial per setup and does not establish general performance or a causal advantage for either framework.

## Results

| Measurement | Pi 1.5.2 | OpenHands 0.56 |
|---|---:|---:|
| Agent arrangement | lead + implementer + reviewer | one CodeAct agent |
| Generation / evaluation | completed / completed | completed / completed |
| Official passed / failed / collection errors | 17 / 10 / 0 | 17 / 10 / 0 |
| Pass rate | 62.96% | 62.96% |
| Generation-container duration | 1100.137 s (18.34 min) | 973.989 s (16.23 min) |
| Reported input tokens | 2,141,292 | 5,347,894 |
| Reported output tokens | 46,283 | 38,771 |
| Reported total tokens | 2,187,575 | 5,386,665 |
| Model responses | 86 | 114 |

OpenHands used **2.46 times** the reported cumulative tokens and finished generation about 2.10 minutes sooner. Most usage in both runs was input context sent again across turns. These are reported token counts, not billing estimates. Both recorded cache counters as zero; that does not independently establish provider billing or cache policy. Generation durations exclude image downloads and the subsequent evaluator. OpenHands observed preflight-through-result time was 988.35 seconds.

## Matched controls

- Exact model `Qwen/Qwen3.5-397B-A17B-FP8`, using the same configured endpoint and credential source.
- Same original `start.md`; SHA-256 equality was verified against Pi's manifest.
- Same evaluator base `ghcr.io/multimodal-art-projection/nl2repobench/jsonlines:1.0`, local image ID `sha256:53d4f953222214651e979d00d81b8b10af86adec9a24982be0ce95e5ece2c246`. Its layers match the base of the saved Pi evaluation image. The new OpenHands evaluator used that unchanged local base and the same official commands and 27 tests.
- Bridge networking with shell egress available. Dedicated browser tools were absent in both. This was not a sealed-network test. Recorded shell calls showed local editable installs and development dependency installs; no upstream target-source download was observed in those calls.
- Configured context setting 262,144 and per-response output limit 8,192; no total-token ceiling. Both retained a one-hour deadline and a 200 response/iteration safeguard, whose units are framework-specific.
- Both started fresh and received no manual source edits, operator steering, or official-test-feedback repair pass. Evaluation ran on a separate copy. Core module, package entry point, setup.py and README matched the pre-processing snapshot byte for byte in both runs.

## Differences and interpretation

The existing benchmark OpenHands adapter launches CodeAct and exposes no Pi-style lead/teammate profile. The pinned CodeAct tool list contained execute_bash, think, finish, execute_ipython_cell, task_tracker and str_replace_editor, with no delegation tool. The user's requested fallback to a single agent was used. This does not claim that OpenHands generally cannot support custom delegation or multi-agent workflows.

Framework prompts, generation images, editors and history management differ. Pi used completion-focused team instructions and a batch writer. OpenHands used the benchmark's stock initial prompt and its standard tool loop, performing many local repair iterations. OpenHands retained its default temperature 0; Pi did not explicitly specify a temperature. Therefore the result compares these two concrete setups, not a controlled estimate of the framework alone or the benefit of adding teammates.

OpenHands passed its own 15-test script before finishing, but the official evaluator passed only 17/27. Its self-assessment is not used as the benchmark score. Final controller state was `finished`, container exit was 0, and no iteration or token stop was required. Final iteration flag: `{"_hit_limit": false, "current_value": 114, "headless_mode": false, "limit_increase_amount": 200, "max_value": 200}`. Recorded completion usage exactly matched aggregate OpenHands metrics.

The successful OpenHands run exceeded both the earlier 100k and 1M trial ceilings. Those ceilings would also have been restrictive for this baseline; code quality and normal completion should still be assessed separately from token stopping.

## Tests with different outcomes

| Official test | Pi | OpenHands |
|---|---|---|
| `test_empty_lines` | pass | fail |
| `test_invalid_lines` | pass | fail |
| `test_open_and_append_writing` | fail | pass |
| `test_typed_reads` | fail | pass |

Eight shared failures cover iterable input, repeated BOM handling, invalid UTF-8, invalid requested types, and writer behavior. Full failed test IDs are retained in the machine-readable comparison.

## Reproduction and artifacts

The benchmark's old `docker.all-hands.dev` hostname did not resolve. The same official release was obtained from GHCR by immutable digest:

- Application: `ghcr.io/all-hands-ai/openhands:0.56@sha256:74335237309a27b46c54a36c9a57d3564a239c2ad1155eb8f805435d2c54b316`
- Runtime: `ghcr.io/all-hands-ai/runtime:0.56-nikolaik@sha256:81e913a848e28c5abbb5dab58aab8f8e163480b44dd369175026b45f4c4fe778`

An isolated local driver wrapped the stock OpenHands controller to preserve its final state and trajectory, then invoked the unchanged shared evaluator. An offline, network-disabled preflight verified the effective model limits and tool list with zero model calls. No benchmark application code or scoring rule was changed for this comparison. The dedicated config containing credentials is ignored and mode 0600. The completed runtime sandbox was removed after preserving its logs.

- Pi run: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6`
- OpenHands run: `jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66`
- OpenHands result: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/result/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66.json`
- Generated source: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66/workspace`
- Machine-readable comparison: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66/artifacts/comparison-data.json`
- Final controller state: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66/artifacts/final-state.json`
- Full trajectory: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66/artifacts/trajectory.json`
- Per-response records: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66/artifacts/completions`
- Driver, wrapper and summary helper: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/openhands-comparison`

The local driver is `logs/openhands-comparison/driver.py`; it launches a fresh live job whenever run. Existing artifacts can be inspected with `monitor.py` or `summarize.py` without model calls. No rerun is needed to inspect this comparison.
