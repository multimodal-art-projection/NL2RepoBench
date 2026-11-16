# Pi versus OpenHands: three-task comparison

Model: **Qwen/Qwen3.5-397B-A17B-FP8**. Pi used a lead and two persistent teammates; OpenHands used one CodeAct agent. Tasks were selected before model calls from the official Easy, Medium and Hard groups.

| Task | Pi score | Pi reported tokens | OpenHands score | OpenHands reported tokens |
|---|---:|---:|---:|---:|
| small: `python-slugify` | 63/82 (76.83%) | 1,000,815 | 0/82 (0.00%) | 4,738,682 |
| medium: `tinydb` | 152/204 (74.51%) | 4,472,657 | 152/204 (74.51%) | 3,914,171 |
| large: `sqlparse` | 56/461 (12.15%) | 5,361,642 | 72/461 (15.62%) | 8,491,755 |
| **Total tokens** | | **10,835,114** | | **17,144,608** |

The equal-weight mean of these three task pass rates is 54.50% for Pi and 30.04% for OpenHands. This is not a full-benchmark score. Counts include repeated input context across actors and responses and are not billing estimates.

Across these three evaluated attempts, OpenHands reported 1.58 times Pi's tokens; Pi used 36.8% fewer. Pi scored higher on the small task, tied on the medium task, and OpenHands scored 16 additional passes on the large task. These are outcomes of the concrete configurations in this pilot.

## Evaluation details

OpenHands python-slugify finished its agent workflow but collected zero tests because its generated package did not export PRE_TRANSLATIONS. Pytest reported one collection error; the existing benchmark parser recorded errors=2 by counting both collection and summary lines. The score remains 0/82. Its pip install -e . also failed while uninstalling a pre-existing editable installation referencing the missing /python-slugify path. The tests still imported generated /workspace/slugify and failed on the missing export. Source and scoring rules were kept unchanged.

OpenHands sqlparse also had one collection error: tests/test_parse.py expected sqlparse.tokens.Number, which its generated module did not expose. The remaining collected tests reported 72 passed, 304 failed and 3 xfailed. The official score uses the unchanged 461-case denominator, yielding 72/461 (15.62%). The existing parser again recorded errors=2 for the single collection error.

Original statuses, command exit codes, failed test IDs and observed collection counts are retained in comparison.json. Workflow completion and functional test score are separate.

## Controls and interpretation

- Same model endpoint and credential source, 262,144 context setting and 8,192 per-response output limit.
- Same task specification bytes and expected counts (82, 204, 461); each paired evaluator used the same locked image ID. Base layers and saved source snapshots were verified.
- Fresh workspaces. Bridge networking, shell egress available, dedicated browser tools disabled. The runs were not network-sealed.
- No total-token ceiling; a one-hour deadline and a 200 response/iteration safeguard remained. These safeguard units are framework-specific.
- No manual source changes, operator steering, official-test-feedback repair passes or score-driven retries. Evaluation used separate copies.
- Pi 1.5.2 used its team ExtensionAPI, native history, batch writer and required workflow validation. OpenHands 0.56 used stock CodeAct tools. Framework prompts, generation images, editors, histories and agent counts differ. OpenHands retained default temperature 0; Pi did not explicitly set temperature. One run per task/setup does not isolate framework or team-size effects.

## Interruption and recovery

The first Pi sqlparse attempt was interrupted when Docker became unavailable overnight. Its finalized native messages account for **569,814 tokens**; an unfinished request may be uncounted. It is preserved separately and excluded from the paired table. The two completed Pi tasks were retained unchanged, and only interrupted Pi sqlparse was regenerated. The initial three OpenHands launch failures occurred before model calls.

Total known reported pilot usage, including the interrupted attempt, is **at least 28,549,536 tokens**. A temporary Windows keep-awake request covered the recovery driver and is released on exit.

## Pi actor usage

| Task | Actor | Reported tokens | Responses |
|---|---|---:|---:|
| `python-slugify` | lead | 52,001 | 5 |
| `python-slugify` | implementer | 797,268 | 34 |
| `python-slugify` | reviewer | 151,546 | 13 |
| `tinydb` | lead | 71,075 | 5 |
| `tinydb` | implementer | 1,322,759 | 38 |
| `tinydb` | reviewer | 3,078,823 | 59 |
| `sqlparse` | lead | 136,638 | 6 |
| `sqlparse` | implementer | 4,939,606 | 74 |
| `sqlparse` | reviewer | 285,398 | 14 |

## Artifacts

- pi / python-slugify: `python-slugify-qwen-qwen3-5-397b-a17b-fp8-776d4a12b80a4a1395a86b821bc33adc`; generation `completed`, evaluation `completed`, scope `completed_generation`.
- pi / tinydb: `tinydb-qwen-qwen3-5-397b-a17b-fp8-7a27de2de390428ea327387790e6a4b9`; generation `completed`, evaluation `completed`, scope `completed_generation`.
- pi / sqlparse: `sqlparse-qwen-qwen3-5-397b-a17b-fp8-a5be5e2da0204ffb814820d48e4d5b90`; generation `completed`, evaluation `completed`, scope `completed_generation`.
- openhands / python-slugify: `python-slugify-openhands-qwen-qwen3-5-397b-a17b-fp8-30ce976b86b14be398e5919840e65ff8`; generation `completed`, evaluation `completed`, scope `completed_generation`.
- openhands / tinydb: `tinydb-openhands-qwen-qwen3-5-397b-a17b-fp8-456a85dee2764e8fa3c8a76e5d6d9a4c`; generation `completed`, evaluation `completed`, scope `completed_generation`.
- openhands / sqlparse: `sqlparse-openhands-qwen-qwen3-5-397b-a17b-fp8-2edc8d9ef5154e80b5e1e88fbc83dac2`; generation `completed`, evaluation `completed`, scope `completed_generation`.

- Machine-readable comparison: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/pi-openhands-three-task-comparison/comparison.json`
- CSV: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/pi-openhands-three-task-comparison/comparison.csv`
- Cohort state and interruption history: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/pi-openhands-three-task-comparison/state.json`
- Original results: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/result`
- Source, sessions and evaluation logs: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/workspaces`

Recorded network-operation lines are retained in comparison.json for inspection. They are not a comprehensive network-capture audit. The local monitor and report helpers inspect saved results without model calls; the run/resume helpers launch live jobs.
