# Completed one-repository Pi validation

The requested one complete NL2Repo task has now run end to end. Success was normal agent/team completion and evaluator execution, independent of test score. No further attempt was made to improve the score.

Task: **jsonlines**. Model: **Qwen/Qwen3.5-397B-A17B-FP8**. Run ID: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6`. Exactly one fresh repository job ran with one lead and two persistent teammates.

| Stage | Observed result |
|---|---|
| Generation | completed |
| Pi extensions | loaded |
| Independent team verification | completed, no errors |
| Task board and teammate reports | both completed |
| Model sessions | three distinct persistent sessions, all settled normally |
| Team messaging | all five messages delivered, including one peer handoff |
| Repository evaluation | completed on a fresh copy |
| pytest | **17 passed, 10 failed, 0 collection errors (27 total)** |
| Overall job / CLI exit | completed / 0 |

The 17/27 test result measures generated-code quality. It did not invalidate the completed agent or benchmark lifecycle. This is a normal completed-generation result, not diagnostic evaluation of a failed run. Agent-written self-assessments are retained as reports; the official evaluator counts above are authoritative.

## Scope and configuration

The user explicitly authorized removing token stopping for this single repository. The dedicated ignored config uses max_total_tokens=null, no role token limits or targets, native Pi history, one selected task, one job at a time, and required workflow validation. The model context window stayed 262,144 and its per-response output limit stayed 8,192. A 3,600-second timeout, 200 shared-response safeguard and cancellation support remained. The ordinary config.pi.local.json retained its 1,000,000-token shared safety cap.

Pinned attrs==25.4.0 and pytest==8.4.2 were installed before model calls. The original workspace is preserved. The evaluator used a separate copy and retained a pre-processing ZIP. A byte-for-byte check of the core module, package entry point, setup.py and README against that ZIP confirmed that evaluation did not alter those original files. No source was manually repaired by the integration agent and no operator steering was injected into the running model sessions.

## Usage and timing

| Actor | Input | Output | Total | Responses |
|---|---:|---:|---:|---:|
| lead | 47,219 | 1,408 | 48,627 | 6 |
| implementer | 1,958,492 | 36,389 | 1,994,881 | 69 |
| reviewer | 135,581 | 8,486 | 144,067 | 11 |

Total: **2,187,575 reported tokens** across 86 responses. Generation-container duration: 1100.137 seconds; observed start-to-result time: 1132.5 seconds (about 18.9 minutes). These are provider-reported cumulative usage values, not a billing estimate or per-request context size.

The implementer recovered from an output-truncated write by issuing smaller batches, then repaired generated-code errors before reporting. It performed more local repair iterations than requested by the completion-focused prompt, but ultimately handed off normally without any token stop. The reviewer completed its review and the lead returned normally. No score-driven rerun followed the official tests.

## Verification and fixes

Before the live run, 28 Python and 33 real Pi SDK mock tests passed (61 total), TypeScript checking passed, and the rebuilt image passed offline tool readiness and all four full mock evaluator profiles at 1/1. New coverage verifies explicit uncapped accounting, normal completion with known failing code checks, a successful evaluation status even at zero passed tests, and bounded missing-report reminders followed by explicit failure instead of hanging dependent review.

## Local artifacts

- Result: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/result/jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6.json`
- Generated repository: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6/workspace`
- Repository snapshot ZIP: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6/evaluation/cca3167f93e84f8daa1d563a9aebafd2/workspace.zip`
- Native sessions and normalized traces: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6/artifacts`
- Evaluation log: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces/jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6/evaluation/cca3167f93e84f8daa1d563a9aebafd2/log.log`
- Driver log: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/pi-one-repository-20261114-184726.log`
- Single-task config: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/config.pi.one-repository.local.json`
- Mock verification: `logs/pi-one-task-contracts.log`, `logs/pi-one-task-build-smoke.log`
