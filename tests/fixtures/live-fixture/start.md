# Small live Pi team fixture

Build two files in /workspace:
- answer.py: define an attrs-decorated class Answer with an integer value defaulting to 42; answer() returns Answer().value; add(a, b) returns a + b.
- README.md: briefly explain this API using actual text, never a history receipt or omission marker.

The pinned attrs dependency is installed before the model starts. No package installation, packaging files, extra tests, or documentation tree is required.

Use the configured lead and two teammates. The lead should call start_team once with implementer and reviewer assignments, then wait_agent target=all. The implementer writes both files together, runs one combined import/basic check, then finish_teammate. The reviewer checks the public API after handoff and uses finish_teammate. These handoff tools update task ownership and deliver reports automatically. Finish with a concise result. This is an integration fixture, not an NL2Repo quality score.
