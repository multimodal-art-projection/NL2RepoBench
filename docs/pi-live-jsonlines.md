# First live jsonlines test

Run on 14 November 2026 using Qwen/Qwen3.5-397B-A17B-FP8 through the configured OpenAI-compatible endpoint.

## Configuration and authentication

The selected task was jsonlines, with one lead, two teammates, one benchmark job at a time, a 900-second deadline, and a shared 50,000-token limit. The declared context window was 262,144 and per-response output limit 8,192. Model-list authentication returned HTTP 200 and included the configured model ID. Full-length context capability was not exercised.

The credential had been placed in apiKeyEnv, which requires a variable name. It was moved into the Git-ignored, mode-0600 config.pi.local.env file. The local JSON now points to NL2REPO_API_KEY. Load that environment file in the same Ubuntu terminal before a future run:

```bash
source config.pi.local.env
```

No credential is included in this report.

## Result

The live attempt stopped at the configured shared budget. It reported 50,217 tokens across 12 assistant responses:

| Actor | Input | Output | Total |
|---|---:|---:|---:|
| Lead | 8,305 | 820 | 9,125 |
| Implementer | 9,528 | 251 | 9,779 |
| Reviewer | 30,793 | 520 | 31,313 |
| Total | 48,626 | 1,591 | 50,217 |

These are reported usage values, not a billing calculation. In-flight responses can exceed the configured soft limit.

All three independent Pi sessions were created. The lead delegated implementation and review and created two task-board items. The run did not reach completed teamwork or write repository source files; functional evaluation was skipped and the score is null. Repeated context input and reviewer filesystem inspection consumed most of the limit.

Result identifier: jsonlines-qwen-qwen3-5-397b-a17b-fp8-253e2d83a0814b27aa57f28f969d85ae.

The result JSON, native sessions, normalized events, stderr, and generated workspace remain available under result/ and workspaces/ for that identifier.

## Runtime defect and correction

The reviewer encountered a real harness dependency error: Pi's find tool required fd, which was absent from the generation image. Debian Bookworm's packaged fd was then tested and proved too old for Pi's --no-require-git flag. The runtime now installs checksum-pinned fd 10.5.2.

A new offline readiness check calls the real Pi find, grep, and ls tools. Live generation runs execute it before model requests, and the production-image mock smoke script also runs it. The Dockerfile is now included in the runtime fingerprint, so build-recipe changes invalidate stale images.

At the end of that first attempt, the live token limit had not been increased and no second paid attempt had been started. The 38 automated contract tests passed. After rebuilding with the compatible binary, the real find/grep/ls readiness check and all three production-image mock smoke profiles passed with external networking disabled. Offline verification results are recorded in logs/pi-live-fix-*.log.

## Authorized 100,000-token retry

A second live run was explicitly authorized on 14 November 2026. It selected only jsonlines, with the same Qwen model, one lead, two teammates, a shared 100,000-token cap, and a 900-second deadline. The offline production-image find/grep/ls readiness checks passed before any model requests.

Run identifier: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-3653615f9773460b8122b8455f5efe08`. Generation failed after 146.494 seconds with `Shared token budget exhausted`. Reported usage was 100,422 tokens across 18 assistant responses; billing cost is unknown.

| Actor | Input | Output | Total | Responses |
|---|---:|---:|---:|---:|
| lead | 61,667 | 1,498 | 63,165 | 10 |
| implementer | 16,160 | 4,636 | 20,796 | 4 |
| reviewer | 16,102 | 359 | 16,461 | 4 |

The lead made five wait_agent calls while teammates were generating. Responses containing those calls accounted for 38,789 reported tokens. The lead consumed 63,165 tokens overall. Repeated full-context input used most of the budget. This is a coordination-efficiency issue; the earlier missing-fd error did not recur.

The workspace contains start.md and a generated jsonlines/jsonlines.py (17,516 bytes), but no package entry point or packaging files. Both teammates were aborted by the shared limit. Two team messages were queued, one was delivered, and there was no completed peer exchange or finished task-board item. The team result is incomplete.

Functional evaluation was skipped because generation failed. The score is null, not zero, and the requested conditional full-repository evaluation did not run. The official jsonlines:1.0 evaluator image was downloaded successfully and is cached. No additional paid run was started. The local configuration now retains the authorized 100,000-token cap and evaluate=false.

The next change should address excessive status polling and review startup before another paid attempt. A larger cap alone has not established a successful end-to-end run.

## Post-fix 100,000-token retry

The user authorized coordination fixes, offline verification, and one further jsonlines attempt at the same 100,000-token shared cap. The lead still had two persistent teammates. Default reviewer startup now waits for the implementer completion report and settlement; wait_agent blocks until actual work settles or the existing task deadline/cancellation occurs. Prompts request batched delegation, file writes and handoffs.

Before the paid retry, 23 Python contracts, 19 real Pi SDK mock tests and TypeScript checking passed. The image was rebuilt, offline find/grep/ls readiness passed, and all three production-image mock profiles (single, external extension, team) scored 1/1 on the deterministic evaluator fixture. The team fixture completed all required exchanges.

Live run: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-968c67623c67406da70420a0e15fd31d`. It failed after 312.21 seconds with `Shared token budget exhausted`, reporting 100,809 tokens across 13 finalized assistant events (including two aborted zero-usage events). The cap was unchanged; response-boundary enforcement allows a small overshoot.

| Actor | Input | Output | Total |
|---|---:|---:|---:|
| lead | 24,449 | 1,563 | 26,012 |
| implementer | 67,832 | 6,965 | 74,797 |
| reviewer | 0 | 0 | 0 |

The lead made one blocking wait_agent call, compared with five in the prior run. It used 26,012 tokens, compared with 63,165 previously. The reviewer made no model requests because implementation never reached handoff. These live observations agree with the mock regressions; the requested coordination changes worked, but end-to-end generation still did not complete within the shared cap.

The implementer used 74,797 tokens. It continued making individual file-write responses despite the batching prompt. Replayed input context accounted for 67,832 of its tokens. Written files are jsonlines/jsonlines.py (20,780 bytes), jsonlines/__init__.py (708 bytes), jsonlines/py.typed, and setup.py (2,612 bytes). The setup.cfg tool call was cancelled before executing. No completion report, review, or completed task-board item was reached.

Functional evaluation was skipped because generation failed; score remains null. No repository test score or complete-repository result is claimed. No additional paid run was started and the 100,000-token configuration remains unchanged. All generation containers stopped and were removed.

Offline follow-up corrected a diagnostic for the deferred actor: Pi lazily creates its native session file at its first turn. The original result reported a missing native reviewer file even though review never started. The verifier now recognizes an unstarted member in an already failed run as deferred, while still requiring native files for started actors and completed runs. Final verification passed 24 Python and 19 SDK mock tests plus type checking (43 tests total). The original live result is preserved; logs/pi-live-coordination-trace-recheck.json records the offline recheck with deferred_actors=[reviewer], no trace errors, and generation still failed.

Artifacts: the saved result under result/, generated source and traces under workspaces/<run-id>/, and logs/pi-live-jsonlines-coordination-20261114-171414.log. Detailed offline verification is in docs/pi-validation.md.

## Batched-write 100,000-token retry and correction

The user authorized batched-write/context-overhead fixes, offline verification, and one further jsonlines run at the same shared 100,000-token cap. The implementation added an ExtensionAPI write_files tool and provider-context compaction of successful write bodies, preserving full native sessions, raw traces and actual file contents. The active single-file write tool is replaced when batch_file_writes is enabled; an opt-out supports comparison.

Before the paid retry, 24 Python and 23 SDK mock contracts passed (47 total), including comparison of actual provider request payloads with and without compaction. The rebuilt image passed offline tool readiness and all three full deterministic evaluator profiles (single, external extension, team; 1/1 each).

Run identifier: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-1522748d5bf842099ce10594bca703b3`. Generation failed after 292.641 seconds with `Shared token budget exhausted`. Reported usage reached 102,331 tokens; the configured 100,000-token limit was unchanged and enforced at response boundaries. No test score was produced.

| Actor | Input | Output | Total |
|---|---:|---:|---:|
| lead | 16,601 | 1,056 | 17,657 |
| implementer | 77,506 | 7,168 | 84,674 |
| reviewer | 0 | 0 | 0 |

The implementer used four write_files calls with batch sizes [3, 4, 2, 6], creating 15 paths. Eight request-history compactions omitted 140,699 source-body characters across subsequent requests; this cumulative figure counts repeated copies, not unique source or token savings. The lead made one blocking wait; the reviewer remained deferred.

Responses containing four dependency/verification bash calls consumed 42,376 reported tokens. An initial import failed because attr was missing; the agent installed attrs and retried successfully. The final broader API check was cancelled at the token cap, so it did not complete. Repeated instructions/tool/history input still dominated overall usage.

### Defect exposed by the live attempt

The first compaction format replaced content fields in successful historical tool arguments with omission markers. Native events prove the model then imitated those markers as content for new files, including fabricated hashes. The writer faithfully wrote the model-supplied strings; the context hook did not modify the original on-disk files. Eight generated files are therefore placeholders, not completed work: MANIFEST.in, .gitignore, .editorconfig, .readthedocs.yaml, LICENSE.rst, README.rst, doc/conf.py, doc/index.rst. Seven paths contain actual generated source/configuration. The incomplete original workspace is preserved without repairs or rescoring.

The corrected format summarizes the entire completed large write call/result pair as ordinary assistant receipt text in provider context, removing both protocol-linked messages. It never inserts placeholder examples into tool arguments. Full original calls/results/source remain in native sessions and normalized traces. Failed, unresolved, unrelated and small calls remain unchanged. write_files now rejects old omission markers and receipt summaries submitted as file content, before writing any file in that batch. Role prompts explicitly require actual complete source.

After this correction, all 24 Python and 24 SDK mock tests passed (48 total), with TypeScript checking. Regressions cover provider payload reduction, original source retention, no placeholder tool arguments, paired-call/result removal without orphan results, unchanged failed/unresolved calls, and rejection of receipt content before any batch file is written. The image was rebuilt and all three full Docker mock evaluator profiles again passed 1/1, including completed team workflow. Log: logs/pi-batch-write-correction-validation.log.

No second paid run was made in this request. The corrected receipt-summary format is offline-validated but has not had a live retry. Generation and team status for the paid run remain failed/incomplete, evaluation was skipped, and score is null. The local cap remains 100,000. Original result, workspace, native traces and model usage are preserved.

## Hardened live gate and 1M pilot

The user authorized setup/handoff/budget fixes, mock validation, a small live fixture, and, only if that fixture passed, one jsonlines attempt with a shared 1,000,000-token cap and repository evaluation.

The updated harness adds bounded pinned dependency bootstrap before model calls; start_team creates owned tasks and actual assignment messages; finish_teammate explicitly completes owned work and sends lead/dependent reports together. Builtin tool sets are narrower while external extension capabilities remain available. The custom write-history compactor is now opt-in; both live stages used native Pi history. The placeholder guard remains enabled.

Before the live gate, all 25 Python and 29 SDK mock tests passed (54 total), TypeScript checking passed, and all three rebuilt-image Docker mock evaluator profiles scored 1/1 with completed team workflow.

### Small live fixture

Run: `live-fixture-qwen-qwen3-5-397b-a17b-fp8-8e34c74901fe43ea9e5397b224ae8ae9`. It completed generation, independent teamwork verification and all four evaluator tests in 82.706 seconds. Reported usage was 41,992 tokens: lead 16,984, implementer 12,542, reviewer 12,466. The shared cap was 75,000, with initial strict allocations 25,000/30,000/20,000.

The fixture generated a small attrs-based API and a real README. Dependency preparation installed attrs==25.4.0 and pytest==8.4.2 before model calls. Five assignment/handoff messages were queued and all five were delivered, including one peer handoff. Both workers called finish_teammate. This is an integration fixture result, not an NL2Repo quality score.

### jsonlines generation

Run: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-1349221454a541208f158034808bc43b`. Only after the live fixture passed, the driver selected the single jsonlines task, one lead and two teammates, shared cap 1,000,000, 120 assistant turns, a 3,600-second deadline, required workflow validation and evaluation enabled. ContextWindow remained 262,144 and maxTokens remained 8,192. Dependency setup and native history matched the passing fixture.

The attempt ran for 857.106 seconds and reported 815,579 tokens. The 1M shared cap was not reached. It stopped on the initial strict per-role policy: implementer 661,434/650,000 and lead 154,145/150,000. The reviewer had a 200,000 allocation but never started, because the implementer was cancelled before handoff. Generation remains failed and teamwork incomplete. This is a limitation introduced by the phase-budget policy, not a Pi SDK failure or a 1M shared-limit failure.

The implementer spent most of its run iterating on generated code: binary/text writer behavior, reader close/EOF behavior, optional JSON backends and static typing. The lead continued inspecting/integrating after the worker stopped and wrote remaining documentation/configuration. These repairs did not produce a completed team run. No generated source was repaired by the integration agent.

### Requested repository tests

The normal evaluator skipped a failed generation. An explicit diagnostic re-evaluation option was therefore added, with a regression proving that it preserves the failed status and original workspace. It invokes the same existing benchmark evaluator on a fresh copy, without model requests.

Diagnostic result: `jsonlines-reevaluation-6f5cd86e4a684e63b39f79f3a7c04472`, source_run_id `jsonlines-qwen-qwen3-5-397b-a17b-fp8-1349221454a541208f158034808bc43b`. Result: **16 passed, 11 failed, 0 collection errors, out of 27 tests (59.3%)**. evaluation_status is completed and evaluation_scope is incomplete_generation; generation_status and overall status remain failed. This is a functional result for the saved source, not a completed multi-agent benchmark-run claim.

Failures cover iterable/empty-line/type validation, invalid-UTF8/error behavior, writer binary/text conversion, writer flags/custom dumps, and writing/appending through open(). The complete pytest output is retained in the diagnostic JSON and evaluation log.

### Policy correction after the pilot

Strict role cancellation stranded unused shared capacity and review. Role allocations are now advisory handoff targets by default; warnings begin at 80%, while the shared token cap remains enforced. enforce_role_token_limits=true explicitly opts into hard per-role stops. The local 1M configuration now sets this flag false. This preserves the actual shared allowance while keeping targets visible, and avoids silently stopping below 1M because an actor crossed an advisory allocation.

The corrected policy, diagnostic evaluator guard and current implementation passed 26 Python plus 30 real SDK mock tests (56 total), TypeScript checking, a rebuilt image, offline tool readiness and all three complete Docker mock evaluator profiles at 1/1. A new regression verifies successful handoff and review after roles cross their advisory targets while remaining below the shared cap.

No further paid retry was started. The advisory policy has not been live-validated; the paid pilot above used the earlier strict policy. Fixture plus repository generation consumed 857,571 reported tokens total; diagnostic evaluation used no model calls. Logs: logs/pi-hardening-contracts.log, logs/pi-hardening-build-smoke.log, logs/pi-hardening-fixture-20261114-180949.log, logs/pi-hardening-jsonlines-20261114-180949.log, logs/pi-hardening-diagnostic-evaluation.log, and logs/pi-hardening-final-validation.log.

### Difference from the OpenHands path

The OpenHands adapter launches its standard 0.56 headless agent with a default 7,200-second timeout and no equivalent shared-token cap in the adapter. The Pi team integration adds three separate contexts, custom orchestration and independent workflow validation. The earlier Pi trials also had a 900-second deadline, 100k cumulative shared input/output caps and experimental history rewriting. The cap explains cancellation, but missing runtime tools/dependencies, marker imitation, and the strict phase policy were integration decisions. This pilot does not establish relative Pi/OpenHands model quality.

## Completed uncapped single-repository task

The user clarified that the goal is a complete agent/benchmark lifecycle for one repository, not maximum score, and explicitly removed token stopping for this one task. A fresh jsonlines job `jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6` completed normally with one lead and two teammates. Generation, extensions, independent teamwork verification, both reports and task-board entries, all five message deliveries and evaluator execution completed. CLI exit was 0. No token or role-token stop occurred.

Official repository result: **17 passed, 10 failed, 0 collection errors out of 27 tests**. This is evaluation_scope=completed_generation and overall status=completed, unlike earlier diagnostic results. The test failures are generated-code quality findings, not an incomplete benchmark run.

Reported usage was 2,187,575 tokens, with generation-container duration 1100.137 seconds. The task ran without manual source edits or operator steering. The ordinary local config retained its prior 1M cap; only the dedicated one-repository config was uncapped. Before the live run, all 61 contracts and four full offline mock evaluator profiles passed. Full evidence and artifact locations are in docs/pi-one-repository-validation.md. No additional run was made to improve test score.
