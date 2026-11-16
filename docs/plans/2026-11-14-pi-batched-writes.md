# Reduce repeated write context

The previous retry spent 67,832 input tokens on implementation, including replayed source from individual file writes. Keep one lead, two teammates, the existing endpoint/model, and the same 100,000-token shared cap.

1. Register a write_files ExtensionAPI tool which writes an array of files via Pi's write tool and returns short path/byte/hash receipts. Replace the active single-file write tool by default while preserving the role's write capability and opt-out configuration.
2. Use the public context hook to omit bodies from historical successful writes in provider requests. Preserve full native session and normalized traces, tool-call IDs/results, failed writes, and all other conversation content. Source remains readable on disk.
3. Verify multi-file writes, containment, cancellation, genuine provider-context omission, original-session retention, opt-out behavior, and existing SDK/mock contracts. Rebuild and run all mock evaluator profiles.
4. After passing mocks, perform one jsonlines retry with the unchanged 100k shared cap. If generation completes, evaluate that saved repository without another model request. Preserve failure artifacts otherwise.

Outcome: initial 47-test and full mock validation passed before the one authorized paid retry. That run used 102,331 reported tokens and did not complete. It exposed model imitation of omission markers. Compaction was then corrected to plain receipt summaries of paired historical calls/results, and receipt content is rejected by the writer. Final 48-test and full mock validation passed, the image was rebuilt, and no additional paid attempt was made. Corrected-format live validation remains outstanding; see docs/pi-live-jsonlines.md.
