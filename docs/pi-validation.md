# Pi mock validation record

Validated on 14 November 2026 in Ubuntu WSL 2 as user `jon86`, with Docker Desktop's Linux engine. The implementation is in the WSL checkout on branch `feat/pi-agent-integration`.

## Automated checks

- 22 Python contract tests passed.
- 16 TypeScript/Pi SDK mock tests passed.
- TypeScript type checking and the compiled production-image build passed.
- Python syntax and Git whitespace checks passed.

The checks cover backend dispatch, preflight validation, unique job outputs, credential separation, mock network isolation, Docker exit/OOM/timeout/cleanup handling, preserved evaluation copies, trace corruption, headless extension behavior, dependency-bearing extension packages, separate persistent sessions, peer messaging, teammate concurrency and concurrent spawn limits, failures, retries, shared budgets, and deadline cancellation.

## Complete Docker pipeline

`python scripts/smoke_pi.py --evaluate-fixture` passed all three configurations through the existing evaluator:

| Configuration | Generation | Workflow | Fixture score | Synthetic mock usage |
|---|---|---|---|---|
| Single agent | completed | not applicable | 1/1 | 90 tokens |
| External extension with flag and startup mode | completed | not applicable | 1/1 | 120 tokens |
| Lead plus two teammates | completed | completed | 1/1 | 750 tokens |

These are deterministic integration-fixture results. Synthetic mock usage does not represent real token billing or NL2Repo model quality. No real model endpoint was called. Mock generation containers used `--network none` and an internal loopback endpoint.

The successful runs are saved under `result` with these IDs:

- `mock-fixture-nl2repo-mock-ffcf26e170394bcca635e8a0fef938b9`
- `mock-fixture-nl2repo-mock-7ea288bf3cdf42f0ba027a475b046ff4`
- `mock-fixture-nl2repo-mock-7bf89bb561a640c0906fc05a6fc8ae97`

The team result contains three distinct persistent session IDs, per-agent usage, completed task ownership, delivered lead/member and peer messages, and no unfinished required messages. Its manifest records the image identity, runtime/dependency fingerprints, role/task hashes, and effective settings.

## Saved-output re-evaluation

`only_test.py` re-evaluated the successful team output without generation and again scored 1/1. It produced:

`mock-fixture-reevaluation-1d3375e1836b40bb85ac95e79e3aee1b`

The original source bytes and saved mock-request counts were unchanged. Build, smoke, and re-evaluation logs are retained locally in `logs/pi-validation-*.log`; generated artifacts and logs are ignored by Git.

## Deliberately deferred

Real-model endpoint compatibility and NL2Repo scores await the user's endpoint and credentials. Larger teams and a complete OpenHands container execution have not been validated. OpenHands configuration/dispatch compatibility is covered by contract tests. Interactive extension UI and session-replacement commands are outside the fixed-identity headless host described in the integration guide.

## First live attempt and runtime dependency fix

The first live jsonlines run reached its shared token limit before writing code and exposed a missing fd dependency. See [the live test record](pi-live-jsonlines.md). A real-tool readiness check and checksum-pinned compatible fd binary were added; further verification for that fix uses only offline checks and mocks.

## Coordination regression verification (14 November 2026)

The scheduler now blocks wait_agent until work settles instead of returning short status timeouts. Default review has an acyclic start_after dependency on implementation completion and settlement. Deferred follow-ups and handoffs are appended to the initial review context without extra model turns. Role prompts encourage batching and avoid waking an implementation worker for a passing review.

Final validation passed: 24 Python unit tests, TypeScript type checking, and 19 real Pi SDK tests (43 tests total) against the local scripted endpoint. New regression coverage checks a single wait despite a legacy 1ms timeout, reviewer start after both completion report and settlement, queued handoffs present before the first review request, wait cancellation, and failed prerequisites producing no reviewer model requests.

The production image was rebuilt. Offline find/grep/ls readiness passed. Full single-agent, external-extension and three-session team smoke runs all passed the deterministic evaluator fixture (score 1/1 each). Mock team status was completed with all messages delivered. The smoke generation containers use network none and made no real model calls.

Logs: logs/pi-coordination-contracts.log and logs/pi-coordination-build-smoke.log. The live follow-up is recorded separately in docs/pi-live-jsonlines.md.

The final Python contract also distinguishes an intentionally deferred actor in a failed run from a started actor whose native session is missing. Started/successful actors still require valid native session files. Final suite output: logs/pi-coordination-contracts-final.log.

## Batched writes and request-history verification

Validation passed: 24 Python tests, 23 real Pi SDK tests against the local mock (47 tests total), and TypeScript checking. The SDK regression writes a 20,000-character payload plus an API file in one write_files call. It verifies that subsequent real provider request payloads omit the large source body, while the on-disk file and original native session retain it. A batch_file_writes=false control keeps the body in history; compared post-write requests differ by more than 35,000 serialized message characters across two requests. These are request-character measurements, not token or billing estimates.

Tests also preserve failed and unresolved write bodies, tool-call IDs/results, and original message objects; reject duplicate/outside/symlink paths before writing; exercise cancellation; and ensure roles without write capability do not gain the batch writer. Tiny bodies are retained when the replacement marker would be larger.

After rebuilding, offline find/grep/ls readiness and all three complete Docker mock evaluator profiles passed with generation networking disabled. Single, external-extension, and three-session team fixtures each scored 1/1; the team workflow completed. Logs: logs/pi-batch-write-contracts.log and logs/pi-batch-write-build-smoke.log. The authorized live retry is recorded in docs/pi-live-jsonlines.md.

### Receipt-format correction after the live trial

The earlier argument-marker format exposed an imitation failure in the live model: it supplied omission markers as new file bodies. This has been corrected. Successful large call/result pairs are now summarized as ordinary receipt text in provider context, while original calls/results remain in native logs. No marker is placed in executable tool arguments. The writer rejects omission-marker/receipt content before beginning a batch.

Final checks passed: 24 Python plus 24 real Pi SDK mock tests (48 total), TypeScript checking, a rebuilt image, offline find/grep/ls readiness, and all three full Docker evaluator fixtures at 1/1 with completed mock teamwork. The corrected format has not been live-retried. Evidence: logs/pi-batch-write-correction-validation.log. Historical paid-run artifacts remain unchanged.

## Workflow hardening and live gate (14 November 2026)

All 25 Python contracts and 29 real Pi SDK mock tests passed (54 total), together with TypeScript checking. New coverage verifies coordinated start/finish with no separate model board/message calls, actual delivered assignment and peer handoff messages, truthful incomplete reports, per-role budget exhaustion without global exhaustion, role warnings, dependency setup with the model credential removed, setup failure before model requests, and native-history defaults. Custom history compaction remains opt-in and its earlier regression tests still pass.

The production image was rebuilt. Offline find/grep/ls readiness and all three complete Docker mock evaluator profiles passed at 1/1 (single, external extension, team), with completed mock teamwork. The live-fixture evaluator image was then built with pinned attrs==25.4.0 and pytest==8.4.2. Logs: logs/pi-hardening-contracts.log and logs/pi-hardening-build-smoke.log.

The small actual-model team fixture passed generation, independent team validation and all four evaluator tests. Run: `live-fixture-qwen-qwen3-5-397b-a17b-fp8-8e34c74901fe43ea9e5397b224ae8ae9`. It used 41,992 reported tokens under a 75,000-token shared cap, with lead=25,000, implementer=30,000 and reviewer=20,000 reservations. It used native Pi history. Dependency preparation completed before model requests. This is an integration fixture score, not an NL2Repo quality score.

The driver then started exactly one authorized jsonlines job with a shared 1,000,000-token cap, role reservations 150,000/650,000/200,000, 120 shared assistant turns, a 3,600-second deadline, native history, required team validation and evaluation enabled. The model context window remained 262,144 and per-response output limit 8,192. Results are recorded in docs/pi-live-jsonlines.md after completion.

### Final pilot outcome and default-policy correction

The actual-model live fixture passed all four tests with completed teamwork at 41,992 reported tokens. The conditional jsonlines attempt used 815,579 reported tokens and stopped on the initial strict role ceilings before review. Diagnostic evaluation of the preserved source passed 16/27 tests, failed 11, with no collection errors; generation/team failure was preserved.

Role allocations are now advisory by default; strict role cancellation is explicit via enforce_role_token_limits=true. The shared cap stays enforced. Final validation passed 26 Python and 30 SDK mock tests (56 total), type checking, a rebuilt image, offline readiness and all three full mock evaluator profiles at 1/1. The advisory correction has not had a paid retry. Evidence: logs/pi-hardening-final-validation.log and docs/pi-live-jsonlines.md.

## Completion-focused single-repository validation

The user clarified that the goal is a normal complete repository-generation/team/evaluator lifecycle, not a maximum test score, and explicitly authorized no token ceiling for one repository. max_total_tokens=null now disables token stopping while preserving usage accounting. The ordinary local capped configuration is unchanged; a dedicated ignored one-repository config selects only jsonlines, one benchmark job, lead plus two teammates, native history, no role token targets/stops and evaluation enabled. Wall-clock, cancellation and turn safeguards remain.

Before the live task, 28 Python and 33 real SDK mock tests passed (61 total), with TypeScript checking. New tests verify uncapped accounting and full teamwork, normally completed generation/review with known failed code checks, successful evaluator status even with zero passed tests, and bounded missing-report reminders followed by explicit failure rather than a blocked reviewer.

The image was rebuilt. Offline tool readiness and all four Docker mock evaluator profiles passed 1/1, including the new uncapped-team path. Generation mock containers use network none. Logs: logs/pi-one-task-contracts.log and logs/pi-one-task-build-smoke.log. The single actual jsonlines run is recorded after completion in docs/pi-live-jsonlines.md.

### Completed live task

The single uncapped jsonlines run completed normally: generation, all three persistent sessions, both teammate reports/tasks, independent workflow verification, all five delivered team messages and official evaluation. The evaluator recorded 17 passed, 10 failed and zero collection errors out of 27, with evaluation_scope=completed_generation and overall status=completed. This fulfills the integration objective independently of score. The ordinary capped config remains unchanged. Full evidence: docs/pi-one-repository-validation.md.
