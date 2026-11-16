# Pi and OpenHands: full repository-run comparison

Model: **Qwen/Qwen3.5-397B-A17B-FP8**. Pi used a lead and two teammates; OpenHands used a single CodeAct agent. The table retains every listed completed attempt, including both OpenHands python-slugify attempts. No new Pi generation was run for the repeat.

| Repository / attempt | Pi score | Pi reported tokens | OpenHands score | OpenHands reported tokens |
|---|---:|---:|---:|---:|
| `jsonlines` | 17/27 (62.96%) | 2,187,575 | 17/27 (62.96%) | 5,386,665 |
| `python-slugify` | 63/82 (76.83%) | 1,000,815 | 0/82 (0.00%)* | 4,738,682 |
| `python-slugify (repeat)` | same Pi baseline | — | 48/82 (58.54%) | 2,108,898 |
| `tinydb` | 152/204 (74.51%) | 4,472,657 | 152/204 (74.51%) | 3,914,171 |
| `sqlparse` | 56/461 (12.15%) | 5,361,642 | 72/461 (15.62%)* | 8,491,755 |
| **Tokens across all listed completed attempts** | | **13,022,689** | | **24,640,171** |

Totals include five OpenHands attempts versus four Pi attempts, so they are expenditure totals rather than an equal-attempt efficiency comparison. Reported tokens include cumulative input context and output; they are not a billing estimate.

* The first OpenHands python-slugify attempt collected zero tests because PRE_TRANSLATIONS was missing from its package-root exports. OpenHands sqlparse had one collection error due to missing sqlparse.tokens.Number, while the other collected tests ran. Both scores use the original fixed test-count denominator. The legacy parser recorded errors=2 for each single collection error.

## Fresh python-slugify repeat

**48 passed, 34 failed, zero collection errors (82 collected; 58.54%).** The agent finished normally at 65 responses and 2,108,898 reported tokens, with no token or iteration stop. Generation duration was 9.30 minutes. The original task, initial prompt, model, endpoint, credential source, evaluation base image, network policy, 262,144 context setting, 8,192 output limit, one-hour deadline, 200-iteration safeguard and lack of a total-token ceiling were retained. Previous hidden-test failures were not supplied to the agent. Generated source was not manually repaired.

The repeat exported PRE_TRANSLATIONS, CYRILLIC, GERMAN and GREEK from slugify/__init__.py. Its source files match the saved pre-processing snapshot byte for byte. Its official pip install step still encountered the original editable-install path problem, but pytest imported the generated workspace package and collected all 82 tests.

A separate disposable, network-disabled diagnostic removed only stale python_slugify.egg-info. Installation then succeeded and pytest again produced **48 passed, 34 failed**. Hashes of all seven Python source/test files were unchanged. This separates the installer problem from the functional score. The diagnostic did not replace the canonical result or modify the agent output.

## Attribution

There were two distinct causes:

- **Benchmark handoff/environment fragility:** the [upstream evaluator](https://github.com/multimodal-art-projection/NL2RepoBench/blob/main/openhands/post_processor.py) removes generated packaging files but retains generated egg-info. The supplied evaluator base contains an editable link to the missing /python-slugify directory. Together these can cause pip to fail when uninstalling the retained package metadata. The failure was reproduced independently, and metadata-only cleanup removed it.
- **Generated API mismatch:** the first package contained PRE_TRANSLATIONS in slugify/special.py but did not re-export it from slugify/__init__.py. This was already present in the agent output, before evaluation. The tests import it from the package root. The [task example](https://github.com/multimodal-art-projection/NL2RepoBench/blob/main/test_files/python-slugify/start.md#L106-L109) instead imports constants from slugify.special; I interpret that as an ambiguity in the description of root exports. The retry supplied those exports on its own.

The task specification and evaluator code matched current upstream after normalizing line endings. The raw byte hashes differed because of line endings, not substantive local modifications. The Pi integration did not introduce these collection or installer errors. sqlparse.tokens.Number is explicitly described in its task specification, so that separate collection failure was a generated-code omission.

## Controls and interpretation

All listed agents finished generation, and evaluation returned recorded scores. The two frameworks still differ in prompts, editor tools, generation images, histories and agent counts; OpenHands retained temperature 0 while Pi did not explicitly set a temperature. One repeat after seeing a failed result is not a new equal-attempt benchmark study. Both python-slugify attempts are retained to make that distinction visible.

A separate Docker-interrupted Pi sqlparse attempt contributed **569,814 recorded tokens** and is excluded from the paired table. Known reported usage for the completed runs listed here plus that interruption is **at least 38,232,674 tokens**; an unfinished interrupted request may be uncounted. Earlier development fixtures and capped pilots are outside this table.

## Artifacts

- pi / jsonlines / original: `jsonlines-qwen-qwen3-5-397b-a17b-fp8-380ec3dd91724286b8d94dc8d513bda6` — 17/27, 2,187,575 reported tokens.
- openhands / jsonlines / original: `jsonlines-openhands-qwen-qwen3-5-397b-a17b-fp8-7680025dbe9548b6a2361772b7ebcb66` — 17/27, 5,386,665 reported tokens.
- pi / python-slugify / first: `python-slugify-qwen-qwen3-5-397b-a17b-fp8-776d4a12b80a4a1395a86b821bc33adc` — 63/82, 1,000,815 reported tokens.
- pi / tinydb / first: `tinydb-qwen-qwen3-5-397b-a17b-fp8-7a27de2de390428ea327387790e6a4b9` — 152/204, 4,472,657 reported tokens.
- pi / sqlparse / first: `sqlparse-qwen-qwen3-5-397b-a17b-fp8-a5be5e2da0204ffb814820d48e4d5b90` — 56/461, 5,361,642 reported tokens.
- openhands / python-slugify / first: `python-slugify-openhands-qwen-qwen3-5-397b-a17b-fp8-30ce976b86b14be398e5919840e65ff8` — 0/82, 4,738,682 reported tokens.
- openhands / tinydb / first: `tinydb-openhands-qwen-qwen3-5-397b-a17b-fp8-456a85dee2764e8fa3c8a76e5d6d9a4c` — 152/204, 3,914,171 reported tokens.
- openhands / sqlparse / first: `sqlparse-openhands-qwen-qwen3-5-397b-a17b-fp8-2edc8d9ef5154e80b5e1e88fbc83dac2` — 72/461, 8,491,755 reported tokens.
- openhands / python-slugify / repeat: `python-slugify-openhands-qwen-qwen3-5-397b-a17b-fp8-ca6c6bd7a4b14263bc857c9cae37e4bd` — 48/82, 2,108,898 reported tokens.

- Full machine-readable comparison: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/openhands-python-slugify-rerun/full-comparison.json`
- CSV: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/openhands-python-slugify-rerun/full-comparison.csv`
- Repeat result: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/result/python-slugify-openhands-qwen-qwen3-5-397b-a17b-fp8-ca6c6bd7a4b14263bc857c9cae37e4bd.json`
- Metadata-only diagnostic: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/openhands-python-slugify-rerun/metadata-cleaned-rerun-evaluation.log`
- Initial-artifact isolation diagnostic: `/home/jon86/projects/NL2Repo_pi_integration/NL2RepoBench/logs/openhands-python-slugify-rerun/metadata-only-diagnostic.log`

The repeat reused the unchanged benchmark evaluator; no shared application code, original task, held-out test, or earlier result was edited. Its temporary keep-awake request ended with the driver.
