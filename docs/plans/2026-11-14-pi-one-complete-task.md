# One complete repository task

The user clarified that success means normal generation/team completion and evaluator execution, regardless of test score, and explicitly authorized removing token-based stopping for this single repository.

- Allow max_total_tokens=null as an explicit opt-in; retain usage accounting, default capped configurations, wall-clock/cancellation/turn safeguards.
- Use a dedicated ignored one-task configuration so the ordinary local config keeps its prior safety limits.
- Make implementation/review completion independent of test success: create all required files, run a bounded smoke/review pass, report known failures, then run the official evaluator.
- Add bounded report reminders for workers and fail missing reports explicitly instead of leaving deferred review waiting forever.
- Verify uncapped accounting, valid failed-code outcomes and missing-report handling with SDK mocks; rebuild and run full offline smoke evaluation.
- Run exactly one fresh jsonlines repository with lead plus two teammates, no token or role-token stops, native Pi history and evaluation enabled. Preserve all reports, source and test results without attempting to maximize score.

Outcome: all 61 contracts and all four full offline mock evaluator profiles passed. The one fresh uncapped jsonlines repository then completed normal generation, both teammate reports and independent team verification, and official evaluator execution. Result: 17/27 passed, 10 failed, no collection errors; the job completed normally. No score optimization rerun was made. Details: docs/pi-one-repository-validation.md.
