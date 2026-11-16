# Pi coordination correction

The previous 100k jsonlines run spent 38,789 reported tokens on five wait responses and launched review before source existed. Keep one lead, two persistent teammates and the same shared 100,000-token live budget.

1. Replace short model-visible wait timeouts with a cancellable wait bounded by the existing task deadline; support waiting for all members.
2. Add configurable acyclic role dependencies. Default review waits until implementation reports completion and settles; batch queued follow-ups and peer handoffs into the initial review context.
3. Clarify batched delegation/file writes and explicit implementation handoff; avoid duplicate reconstruction and progress-only messages.
4. Verify delayed handoff, no polling, dependency failure, cancellation, configuration contracts and existing SDK mocks. Build the production image, run offline readiness and full deterministic evaluator smoke tests.
5. Only after mock checks pass, run one new jsonlines generation at 100k. If completed, evaluate that saved repository without another model run. Preserve failures and usage if the cap is reached.

Outcome: all coordination changes and offline checks completed. The authorized live retry reached the unchanged shared cap at 100,809 reported tokens; implementation remained incomplete, so the conditional repository evaluation was skipped. Lead polling reduced to one blocking wait and the reviewer remained deferred. Details and evidence are in docs/pi-live-jsonlines.md.
