import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { runBenchmark } from "../src/main.js";
import type { RuntimeConfig } from "../src/types.js";
import { Coordinator } from "../src/extensions/team.js";
import { Budget, Trace } from "../src/events.js";
import { writeFiles, compactWriteHistory } from "../src/extensions/files.js";
import { prepareEnvironment } from "../src/setup.js";
import type { Sessions } from "../src/session.js";

function fixture(profile: "single" | "team" = "single"): { root: string; config: RuntimeConfig; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "nl2repo-test-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "start.md"), "Implement answer.py exposing answer() returning 42.\n");
  const config: RuntimeConfig = { schema_version: 1, run_id: "contract-test", profile, mock: true,
    workspace, home: join(root, "pi-home"), artifacts: join(root, "artifacts"), teammates: 2,
    max_active_teammates: 2, task_timeout_seconds: 20, max_total_tokens: 50000, max_turns: 80,
    max_messages: 40, workflow_validation: "report", extensions: [], extension_options: {}, startup_commands: [],
    roles: ["implementer", "reviewer"].map(name => ({ name, prompt: "Read start.md. Communicate, complete your owned tasks, then finish_teammate.", tools: ["read", "write", "bash"], start_after: name === "reviewer" ? ["implementer"] : [] })),
    model: { id: "mock", api: "openai-completions", baseUrl: "https://must-never-be-used.invalid", contextWindow: 131072,
      maxTokens: 4096, reasoning: false, thinking: "off" } };
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("single-agent uses the real SDK/tool loop against the local mock and persists its session", async () => {
  const { config, cleanup } = fixture();
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "not_applicable");
    assert.match(readFileSync(join(config.workspace, "answer.py"), "utf8"), /return 42/);
    assert.equal(result.actors.length, 1);
    assert.ok(readFileSync(result.actors[0].session_file, "utf8").includes("answer.py"));
    assert.equal(result.usage.total_tokens, result.usage.assistant_responses * 30);
  } finally { cleanup(); }
});

test("extension tools, flags, mode commands, events and shutdown work headlessly", async () => {
  const { config, cleanup } = fixture();
  config.extensions = [{ path: resolve("test/fixtures/probe.ts"), scope: "lead" }];
  config.extension_options = { "probe-label": "configured-value" };
  config.startup_commands = ["/probe-mode"];
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.deepEqual(JSON.parse(readFileSync(join(config.workspace, "probe.json"), "utf8")),
      { value: "mock-value", label: "configured-value", mode: true });
    assert.equal(readFileSync(join(config.workspace, "lifecycle.log"), "utf8"), "start hasUI=false\nshutdown\n");
  } finally { cleanup(); }
});

test("lead plus two persistent teammates exchange lead/peer messages and finish shared tasks", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    assert.equal(result.actors.length, 3);
    assert.equal(new Set(result.actors.map((a: { session_id: string }) => a.session_id)).size, 3);
    assert.ok(result.team.peer_messages >= 1);
    assert.equal(result.team.delivered_messages, result.team.queued_messages);
    assert.equal(result.team.tasks.length, 2);
    assert.equal(Object.keys(result.usage.actors).length, 3);
    for (const actor of result.actors) assert.ok(readFileSync(actor.session_file, "utf8").length > 0);
  } finally { cleanup(); }
});

test("worker concurrency can be limited independently of teammate count", async () => {
  const { config, cleanup } = fixture("team");
  config.max_active_teammates = 1;
  try {
    const result = await runBenchmark(config);
    assert.equal(result.team.status, "completed", JSON.stringify(result));
  } finally { cleanup(); }
});

for (const scenario of ["error", "length"] as const) {
  test(`a ${scenario} response cannot masquerade as generation success`, async () => {
    const { config, cleanup } = fixture();
    try { assert.equal((await runBenchmark(config, scenario)).runtime_generation_status, "failed"); }
    finally { cleanup(); }
  });
}

test("broken required extension fails without any model requests", async () => {
  const { root, config, cleanup } = fixture();
  const path = join(root, "broken.ts");
  writeFileSync(path, "export default () => { throw new Error('broken extension'); };\n");
  config.extensions = [{ path, scope: "lead" }];
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "failed");
    assert.equal(result.extension_status, "error");
    assert.deepEqual(result.mock_requests, {});
  } finally { cleanup(); }
});

test("early lead finish and worker errors produce incomplete workflow evidence", async () => {
  for (const scenario of ["early-lead", "worker-error"] as const) {
    const { config, cleanup } = fixture("team");
    try { assert.equal((await runBenchmark(config, scenario)).team.status, "incomplete"); }
    finally { cleanup(); }
  }
});

test("shared token budget cancels a run and retains partial usage", async () => {
  const { config, cleanup } = fixture("team");
  config.max_total_tokens = 30;
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "failed");
    assert.match(result.budget_error, /token budget/);
    assert.ok(result.usage.total_tokens >= 30);
  } finally { cleanup(); }
});

test("a transient mock rate limit is recovered by Pi's own retry behavior", async () => {
  const { config, cleanup } = fixture();
  try {
    const result = await runBenchmark(config, "rate-limit-once");
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
  } finally { cleanup(); }
});

test("a hanging model is cancelled at the task deadline", async () => {
  const { config, cleanup } = fixture();
  config.task_timeout_seconds = 1;
  try {
    const result = await runBenchmark(config, "hang");
    assert.equal(result.runtime_generation_status, "timeout", JSON.stringify(result));
    assert.match(result.budget_error, /timeout/);
  } finally { cleanup(); }
});

test("unknown flags and colliding required extensions fail preflight", async () => {
  const { config, cleanup } = fixture();
  config.extension_options = { "unknown-flag": true };
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "failed");
    assert.deepEqual(result.mock_requests, {});
  } finally { cleanup(); }
  const second = fixture();
  try {
    const source = readFileSync(resolve("test/fixtures/probe.ts"), "utf8");
    const duplicate = join(second.root, "duplicate.ts");
    writeFileSync(duplicate, source);
    second.config.extensions = [resolve("test/fixtures/probe.ts"), duplicate].map(path => ({ path, scope: "lead" as const }));
    const result = await runBenchmark(second.config);
    assert.equal(result.runtime_generation_status, "failed");
    assert.deepEqual(result.mock_requests, {});
  } finally { second.cleanup(); }
});

test("member-scoped extensions do not leak their capabilities to the lead", async () => {
  const { config, cleanup } = fixture("team");
  config.extensions = [{ path: resolve("test/fixtures/probe.ts"), scope: "members" }];
  try {
    const result = await runBenchmark(config);
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    const manifest = JSON.parse(readFileSync(join(config.artifacts, "manifest.json"), "utf8"));
    assert.ok(!manifest.lead_tools.includes("contract_probe"));
    assert.ok(readFileSync(join(config.workspace, "lifecycle.log"), "utf8").includes("start hasUI=false"));
  } finally { cleanup(); }
});

test("directory extensions can load a prepared local runtime dependency", async () => {
  const { root, config, cleanup } = fixture();
  const extension = join(root, "package-extension");
  mkdirSync(join(extension, "dependency"), { recursive: true });
  mkdirSync(join(extension, "src"));
  writeFileSync(join(extension, "dependency/package.json"), JSON.stringify({ name: "local-dep", version: "1.0.0", type: "module", main: "index.js" }));
  writeFileSync(join(extension, "dependency/index.js"), "export const value = 42;\n");
  writeFileSync(join(extension, "package.json"), JSON.stringify({ name: "fixture-extension", private: true, type: "module",
    pi: { extensions: ["./src/entry.ts"] }, dependencies: { "local-dep": "file:./dependency" } }));
  writeFileSync(join(extension, "src/entry.ts"), `import {value} from 'local-dep'; import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
    export default pi => { pi.on('session_start', (_e, ctx) => writeFileSync(join(ctx.cwd, 'dependency.txt'), String(value))); };\n`);
  execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: extension, stdio: "pipe" });
  config.extensions = [{ path: extension, scope: "lead" }];
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(readFileSync(join(config.workspace, "dependency.txt"), "utf8"), "42");
  } finally { cleanup(); }
});

test("concurrent spawn calls cannot exceed the configured limit or reuse a name", async () => {
  const { config, cleanup } = fixture("team");
  const created: string[] = [];
  const fake = { create: async (name: string) => {
    created.push(name);
    await new Promise(resolve => setTimeout(resolve, 10));
    return { id: name, settled: true, errors: [], lastStopReason: "stop", session: { sessionId: name, prompt: async () => {} } };
  }, onMessage: undefined } as unknown as Sessions;
  const team = new Coordinator(config, fake, new Trace(config), new Budget(config));
  try {
    const results = await Promise.allSettled([team.spawn("one", "implementer", "task"),
      team.spawn("two", "reviewer", "task"), team.spawn("three", "reviewer", "task"), team.spawn("one", "implementer", "task")]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
    assert.deepEqual(created.sort(), ["one", "two"]);
  } finally { cleanup(); }
});

test("workflow checks can be explicitly disabled without claiming a completed team", async () => {
  const { config, cleanup } = fixture("team");
  config.workflow_validation = "off";
  try {
    const result = await runBenchmark(config, "early-lead");
    assert.equal(result.runtime_generation_status, "completed");
    assert.equal(result.team.status, "not_checked");
  } finally { cleanup(); }
});

function events(path: string): any[] {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

test("slow implementation uses one blocking wait and reviewer starts after a settled handoff", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config, "slow-handoff");
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    const lead = events(join(config.artifacts, "lead/events.jsonl"));
    const waits = lead.filter(e => e.type === "tool_execution_start" && e.data.toolName === "wait_agent");
    assert.equal(waits.length, 1, "workers should finish inside one wait even with a legacy 1ms timeout");
    const waitEnd = lead.find(e => e.type === "tool_execution_end" && e.data.toolName === "wait_agent");
    assert.ok(waitEnd.data.result.details.every((m: any) => m.state === "completed"));
    const team = events(join(config.artifacts, "team-events.jsonl"));
    const handoff = team.find(e => e.type === "member_finished" && e.actor_id === "implementer");
    const reviewStart = team.find(e => e.type === "member_started" && e.actor_id === "reviewer");
    const implementer = events(join(config.artifacts, "members/implementer/events.jsonl"));
    const settle = implementer.find(e => e.type === "agent_settled");
    assert.ok(reviewStart.sequence > handoff.sequence && reviewStart.sequence > settle.sequence);
    const received = team.filter(e => e.type === "message_delivered" && e.actor_id === "reviewer");
    const firstReview = events(join(config.artifacts, "members/reviewer/events.jsonl")).find(e => e.type === "agent_start");
    assert.ok(received.length >= 2);
    assert.ok(received.slice(0, 2).every(e => e.sequence < firstReview.sequence), "queued follow-up and handoff belong to initial context");
  } finally { cleanup(); }
});

test("blocking wait respects cancellation without starting another model turn", async () => {
  const { config, cleanup } = fixture("team");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const fake = { create: async (id: string) => ({ id, settled: false, errors: [], session: { sessionId: id, prompt: () => pending, sendCustomMessage: async () => {} } }), actors: new Map(), onMessage: undefined } as unknown as Sessions;
  const budget = new Budget(config);
  const team = new Coordinator(config, fake, new Trace(config), budget);
  try {
    await team.spawn("implementer", "implementer", "task");
    const controller = new AbortController();
    const wait = team.wait("all", 1, controller.signal);
    controller.abort();
    await assert.rejects(wait, /abort/i);
    assert.equal(budget.totalTurns, 0);
  } finally { release(); await pending; await new Promise(resolve => setTimeout(resolve, 0)); cleanup(); }
});

test("a failed prerequisite never starts the reviewer model", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config, "worker-error");
    assert.equal(result.team.status, "incomplete");
    assert.equal(result.mock_requests.reviewer, undefined);
    assert.ok(result.team.members.some((m: any) => m.role === "reviewer" && /Prerequisite/.test(m.error)));
  } finally { cleanup(); }
});

test("batch writes use the real SDK and completed source is absent from later provider payloads", async () => {
  const optimized = fixture();
  optimized.config.compact_write_history = true;
  const baseline = fixture();
  baseline.config.batch_file_writes = false;
  try {
    const result = await runBenchmark(optimized.config, "write-history");
    const control = await runBenchmark(baseline.config, "write-history");
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(control.runtime_generation_status, "completed", JSON.stringify(control));
    assert.match(readFileSync(join(optimized.config.workspace, "answer.py"), "utf8"), /return 42/);
    const payload = readFileSync(join(optimized.config.workspace, "docs/payload.txt"), "utf8");
    assert.ok(payload.length > 20000);
    assert.ok(readFileSync(result.actors[0].session_file, "utf8").includes("MOCK_LARGE_FILE_MARKER"));
    const trace = events(join(optimized.config.artifacts, "lead/events.jsonl"));
    const writes = trace.filter(e => e.type === "tool_execution_end" && e.data.toolName === "write_files");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.result.details.file_count, 2);
    assert.ok(!JSON.stringify(writes[0].data.result).includes("MOCK_LARGE_FILE_MARKER"));
    assert.ok(trace.some(e => e.type === "write_history_compacted" && e.data.removed_characters > 19000));
    assert.ok(!result.mock_observations.some((o: any) => o.has_large_file_marker));
    assert.ok(!result.mock_observations.some((o: any) => o.has_tool_argument_omission_marker));
    assert.ok(result.mock_observations.every((o: any) => !o.active_tools.includes("write") && o.active_tools.includes("write_files")));
    assert.ok(control.mock_observations.some((o: any) => o.has_large_file_marker));
    assert.ok(control.mock_observations.every((o: any) => o.active_tools.includes("write") && !o.active_tools.includes("write_files")));
    const chars = (run: any) => run.mock_observations.filter((o: any) => o.step >= 2).reduce((n: number, o: any) => n + o.message_characters, 0);
    assert.ok(chars(control) - chars(result) > 35000, "compare actual provider request characters, not synthetic token usage");
  } finally { optimized.cleanup(); baseline.cleanup(); }
});

test("write batches validate all paths and duplicate targets before writing, and support cancellation", async () => {
  const { root, config, cleanup } = fixture();
  try {
    await assert.rejects(writeFiles(config.workspace, [{ path: "first.txt", content: "safe" }, { path: "../outside", content: "no" }]), /inside/);
    assert.ok(!existsSync(join(config.workspace, "first.txt")));
    await assert.rejects(writeFiles(config.workspace, [{ path: "first.txt", content: "one" }, { path: "./first.txt", content: "two" }]), /Duplicate/);
    symlinkSync(root, join(config.workspace, "link"));
    await assert.rejects(writeFiles(config.workspace, [{ path: "link/escape", content: "no" }]), /symlink/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(writeFiles(config.workspace, [{ path: "first.txt", content: "no" }], controller.signal), /aborted/i);
    assert.ok(!existsSync(join(config.workspace, "first.txt")));
  } finally { cleanup(); }
});

test("history summaries preserve failed/unresolved calls and originals without orphan results", () => {
  const body = "large-source-".repeat(300);
  const messages: any[] = [
    { role: "assistant", content: [{ type: "toolCall", id: "ok", name: "write", arguments: { path: "ok.py", content: body } },
      { type: "toolCall", id: "bad", name: "write", arguments: { path: "bad.py", content: body } },
      { type: "toolCall", id: "pending", name: "write", arguments: { path: "pending.py", content: body } }] },
    { role: "toolResult", toolCallId: "ok", isError: false, content: [{ type: "text", text: "written" }] },
    { role: "toolResult", toolCallId: "bad", isError: true, content: [{ type: "text", text: "failed" }] },
  ];
  const original = JSON.stringify(messages);
  const compacted = compactWriteHistory(messages);
  const parts = (compacted.messages[0] as any).content;
  assert.equal(parts[0].type, "text");
  assert.match(parts[0].text, /sha256/);
  assert.ok(!parts[0].text.includes("[Written file body omitted"));
  assert.equal(parts[1].arguments.content, body);
  assert.equal(parts[2].arguments.content, body);
  assert.ok(!compacted.messages.some(m => m.role === "toolResult" && m.toolCallId === "ok"));
  assert.strictEqual(compacted.messages[1], messages[2]);
  assert.equal(JSON.stringify(messages), original);
});

test("roles without write capability do not gain the batch writer", async () => {
  const { config, cleanup } = fixture("team");
  config.roles[0].tools = ["read", "bash"];
  try {
    await runBenchmark(config, "worker-error");
    const actor = events(join(config.artifacts, "members/implementer/events.jsonl")).find(e => e.type === "actor_created");
    assert.ok(!actor.data.tools.includes("write") && !actor.data.tools.includes("write_files"));
  } finally { cleanup(); }
});

test("receipt placeholders are rejected before any file in a batch is written", async () => {
  const { config, cleanup } = fixture();
  try {
    await assert.rejects(writeFiles(config.workspace, [{ path: "real.py", content: "x = 1\n" },
      { path: "fake.py", content: "[Written file body omitted from request history; bytes=1542 sha256=fake. Use read to inspect current source.]" }]), /actual complete source/);
    assert.ok(!existsSync(join(config.workspace, "real.py")));
    assert.ok(!existsSync(join(config.workspace, "fake.py")));
  } finally { cleanup(); }
});

test("coordinated setup and finish deliver real handoffs without extra board/message model calls", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    const paths = ["lead/events.jsonl", "members/implementer/events.jsonl", "members/reviewer/events.jsonl"];
    const calls = paths.flatMap(path => events(join(config.artifacts, path)).filter(e => e.type === "tool_execution_start").map(e => e.data.toolName));
    assert.equal(calls.filter(name => name === "start_team").length, 1);
    assert.equal(calls.filter(name => name === "finish_teammate").length, 2);
    assert.ok(!calls.includes("send_message") && !calls.includes("team_task"));
    assert.ok(result.team.tasks.every((task: any) => task.status === "completed"));
    assert.equal(result.team.delivered_messages, result.team.queued_messages);
    assert.ok(result.team.peer_messages >= 1);
  } finally { cleanup(); }
});

test("native Pi history is the default and the custom compactor is opt-in", async () => {
  const { config, cleanup } = fixture();
  try {
    const result = await runBenchmark(config, "write-history");
    assert.equal(result.runtime_generation_status, "completed");
    assert.ok(result.mock_observations.some((o: any) => o.has_large_file_marker));
    assert.ok(!events(join(config.artifacts, "lead/events.jsonl")).some(e => e.type === "write_history_compacted"));
  } finally { cleanup(); }
});

test("role reservation cancels an exhausted worker without consuming the shared budget or running review", async () => {
  const { config, cleanup } = fixture("team");
  config.role_token_limits = { implementer: 60 };
  config.enforce_role_token_limits = true;
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "failed", JSON.stringify(result));
    assert.match(result.role_budget_errors.implementer, /Role token budget exhausted/);
    assert.ok(!result.budget_error);
    assert.ok(result.usage.total_tokens < config.max_total_tokens!);
    assert.equal(result.mock_requests.reviewer, undefined);
  } finally { cleanup(); }
});

test("role warning precedes its ceiling and an incomplete report never closes owned work", async () => {
  const { config, cleanup } = fixture("team");
  config.role_token_limits = { implementer: 100 };
  const budget = new Budget(config); budget.register("worker", "implementer");
  budget.add("worker", { input: 81, totalTokens: 81 });
  assert.match(budget.notice("worker")!, /81\/100/);
  const fake = { create: async (id: string) => ({ id, settled: true, errors: [], session: { sessionId: id, prompt: async () => {}, sendCustomMessage: async () => {} } }), actors: new Map(), onMessage: undefined } as unknown as Sessions;
  const team = new Coordinator(config, fake, new Trace(config), new Budget(config));
  try {
    await team.spawn("worker", "implementer", "task");
    team.finish("worker", "Cannot complete the task within the role limit", "incomplete");
    assert.ok([...team.tasks.values()].every(task => task.status !== "completed"));
    assert.ok(team.summary().status === "incomplete");
  } finally { await new Promise(resolve => setTimeout(resolve, 0)); cleanup(); }
});

test("dependency bootstrap strips the model credential and failures stop before model requests", async () => {
  const { root, config, cleanup } = fixture();
  const previousPath = process.env.PATH; const previousPython = process.env.PYTHONPATH; const previousKey = process.env.NL2REPO_MODEL_API_KEY;
  mkdirSync(config.artifacts, { recursive: true });
  const bin = join(root, "bin"); mkdirSync(bin);
  const executable = join(bin, "python");
  config.python_packages = ["attrs==25.4.0"];
  try {
    process.env.PATH = `${bin}:${previousPath}`; process.env.NL2REPO_MODEL_API_KEY = "mock-private-key";
    writeFileSync(executable, '#!/bin/sh\n[ -z "$NL2REPO_MODEL_API_KEY" ] || exit 23\nprintf "bootstrap-ok\\n"\nexit 0\n'); chmodSync(executable, 0o755);
    const setup = await prepareEnvironment(config);
    assert.equal(setup.status, "completed");
    assert.ok(process.env.PYTHONPATH!.includes(setup.target!));
    assert.match(readFileSync(join(config.artifacts, "setup.log"), "utf8"), /bootstrap-ok/);
    writeFileSync(executable, '#!/bin/sh\nexit 7\n'); chmodSync(executable, 0o755);
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "failed");
    assert.equal(result.setup.status, "failed");
    assert.equal(result.mock_requests, undefined);
    assert.equal(result.actors.length, 0);
    assert.equal(result.usage.total_tokens, 0);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousPython === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previousPython;
    if (previousKey === undefined) delete process.env.NL2REPO_MODEL_API_KEY; else process.env.NL2REPO_MODEL_API_KEY = previousKey;
    cleanup();
  }
});

test("advisory role targets allow handoff and review to finish below the actual shared cap", async () => {
  const { config, cleanup } = fixture("team");
  config.role_token_limits = { lead: 60, implementer: 60, reviewer: 60 };
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    assert.deepEqual(result.role_budget_errors, {});
    assert.ok(result.usage.actors.implementer.total > 60);
    assert.ok(result.usage.actors.reviewer.total > 60);
    assert.ok(result.usage.total_tokens < config.max_total_tokens!);
  } finally { cleanup(); }
});

test("an uncapped one-task run retains usage and finishes all three actors", async () => {
  const { config, cleanup } = fixture("team");
  config.max_total_tokens = null;
  config.role_token_limits = {};
  try {
    const result = await runBenchmark(config);
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    assert.ok(result.usage.total_tokens > 0);
    assert.ok(!result.budget_error);
  } finally { cleanup(); }
});

test("failed code checks are valid benchmark outcomes when generation and teamwork finish", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config, "known-failures");
    assert.equal(result.runtime_generation_status, "completed", JSON.stringify(result));
    assert.equal(result.team.status, "completed", JSON.stringify(result));
    assert.match(readFileSync(join(config.workspace, "answer.py"), "utf8"), /return 41/);
    for (const name of ["implementer", "reviewer"]) {
      const rows = events(join(config.artifacts, `members/${name}/events.jsonl`));
      assert.ok(rows.some(e => e.type === "tool_execution_end" && e.data.toolName === "bash" && e.data.isError));
    }
  } finally { cleanup(); }
});

test("missing worker reports are reminded then fail explicitly instead of hanging dependent review", async () => {
  const { config, cleanup } = fixture("team");
  try {
    const result = await runBenchmark(config, "missing-report");
    assert.equal(result.team.status, "incomplete");
    assert.ok(result.team.members.some((m: any) => /required finish_teammate report/.test(m.error ?? "")));
    assert.ok(!result.budget_error);
    assert.equal(result.mock_requests.reviewer, undefined);
  } finally { cleanup(); }
});
