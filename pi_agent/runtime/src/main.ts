import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Budget, Trace, writeJson } from "./events.js";
import { Coordinator } from "./extensions/team.js";
import { startMockServer, type MockScenario } from "./mock.js";
import { Sessions } from "./session.js";
import { prepareEnvironment } from "./setup.js";
import { verifyRuntimeTools } from "./readiness.js";
import type { RuntimeConfig } from "./types.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export async function runBenchmark(config: RuntimeConfig, scenario: MockScenario = "normal"): Promise<Record<string, any>> {
  if (config.schema_version !== 1) throw new Error("Unsupported runtime configuration schema");
  for (const directory of [config.home, config.artifacts, config.workspace]) mkdirSync(directory, { recursive: true });
  const previousPythonPath = process.env.PYTHONPATH;
  let setup: Record<string, unknown> = { status: "not_started", packages: config.python_packages ?? [] };
  const trace = new Trace(config);
  const budget = new Budget(config);
  let mock: Awaited<ReturnType<typeof startMockServer>> | undefined;
  let sessions: Sessions | undefined;
  let coordinator: Coordinator | undefined;
  let generation = "failed";
  let extensionStatus = "loaded";
  let failure: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let manifest: Record<string, unknown> = {};
  const signalHandler = () => budget.fail("Run cancelled by termination signal");
  process.once("SIGTERM", signalHandler);
  process.once("SIGINT", signalHandler);
  try {
    if (!config.mock) await verifyRuntimeTools();
    setup = await prepareEnvironment(config);
    writeJson(join(config.artifacts, "setup.json"), setup);
    if (config.mock) {
      mock = await startMockServer(scenario);
      // Ignore any supplied external endpoint whenever mock mode is selected.
      config.model = { ...config.model, id: "nl2repo-mock", api: "openai-completions", baseUrl: mock.baseUrl };
      process.env.NL2REPO_MODEL_API_KEY = "mock-not-a-secret";
    }
    const { thinking: _thinking, baseUrl, api, ...model } = config.model;
    const modelsPath = join(config.home, "models.json");
    writeJson(modelsPath, { providers: { nl2repo: { api, baseUrl, apiKey: "$NL2REPO_MODEL_API_KEY", models: [
      { ...model, name: model.id, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ] } } });
    const models = await ModelRuntime.create({ modelsPath, authPath: join(config.home, "auth.json"),
      modelsStorePath: join(config.home, "model-cache"), allowModelNetwork: false, refreshOnCreate: false });
    if (models.getError()) throw new Error(models.getError());
    sessions = new Sessions(config, models, trace, budget);
    budget.abort = () => { void sessions?.abortAll(); };
    timer = setTimeout(() => budget.fail("Task execution timeout"), config.task_timeout_seconds * 1000);
    if (config.profile === "team") coordinator = new Coordinator(config, sessions, trace, budget);
    const teamInstructions = coordinator ? `Use exactly ${config.teammates} persistent teammates with configured roles (${config.roles.map(r => r.name).join(", ")}). ` +
      "Read start.md once. Call start_team with one assignment per role; it creates owned tasks and delivers delegation messages. " +
      "Delegate source implementation and a single import check to the implementer, and behavioral verification to the reviewer. " +
      "The reviewer starts after the implementer hands off. Members use finish_teammate once to complete their tasks and send reports automatically. " +
      "Then call wait_agent target=all once. Do not poll. Integrate their delivered findings and give a concise final result. " +
      "This run validates benchmark operation, not maximum score. Produce a complete initial repository attempt, perform one review pass, and finish with known failures recorded. " +
      "Failing repository tests do not mean the agent or benchmark failed. Do not pursue repeated type-checking or repair loops until all tests pass. " +
      "The lead collects reports and finishes without redoing implementation or checks. If required files were not attempted, report that honestly." : "Complete this task as a single agent.";
    const lead = await sessions.create("lead", `${teamInstructions} Dependency setup: ${JSON.stringify(setup)}.`, coordinator ? [coordinator.extension("lead")] : [], ["read", "bash", "edit", "write"]);
    for (const command of config.startup_commands) {
      const name = command.slice(1).split(/\s/, 1)[0];
      if (!lead.session.resourceLoader.getExtensions().extensions.some(ext => ext.commands.has(name))) throw new Error(`Unknown startup extension command: ${name}`);
      await lead.session.prompt(command);
    }
    const task = readFileSync(join(config.workspace, "start.md"), "utf8");
    manifest = { schema_version: 1, run_id: config.run_id, pi_version: "1.5.2", node_version: process.version,
      package_lock_sha256: sha(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")),
      runtime_source_sha256: process.env.NL2REPO_RUNTIME_SHA256 ?? null,
      benchmark: config.benchmark ?? null, setup,
      role_token_limits: config.role_token_limits ?? {}, enforce_role_token_limits: config.enforce_role_token_limits === true,
      mock: config.mock, profile: config.profile, model: config.model,
      batch_file_writes: config.batch_file_writes !== false, write_history: config.compact_write_history === true ? "successful large write call/result pairs summarized as receipt text in provider context only" : "native Pi history", task_sha256: sha(task),
      roles: config.roles.map(role => ({ ...role, prompt_sha256: sha(role.prompt) })),
      extensions: config.extensions, extension_options: config.extension_options, startup_commands: config.startup_commands,
      resource_policy: "explicit resources only; project trust disabled; no host configuration",
      session_replacement: "disabled to preserve benchmark actor identity",
      budgets: { total_tokens: config.max_total_tokens, turns: config.max_turns, messages: config.max_messages,
        timeout_seconds: config.task_timeout_seconds, max_active_teammates: config.max_active_teammates },
      lead_tools: lead.session.getActiveToolNames(), system_prompt_sha256: sha(lead.session.systemPrompt) };
    writeJson(join(config.artifacts, "manifest.json"), manifest);
    budget.check();
    await lead.session.prompt(`Read ${join(config.workspace, "start.md")} and implement the complete repository in ${config.workspace}. Follow its API Usage Guide and runtime requirements. ${teamInstructions}`);
    if (!budget.failure) await coordinator?.drain();
    budget.check();
    if (Object.keys(budget.roleFailures).length) throw new Error(Object.values(budget.roleFailures).join("; "));
    if (!lead.settled || !lead.lastStopReason || ["error", "aborted", "length"].includes(lead.lastStopReason)) {
      throw new Error(`Lead did not complete: ${lead.lastStopReason ?? "no final response"}`);
    }
    if ([...sessions.actors.values()].some(actor => actor.errors.length)) throw new Error("Required extension failed");
    const recognized = new Set([...sessions.actors.values()].flatMap(actor => actor.session.resourceLoader.getExtensions().extensions.flatMap(ext => [...ext.flags.keys()])));
    for (const flag of Object.keys(config.extension_options)) if (!recognized.has(flag)) throw new Error(`Unknown extension flag: ${flag}`);
    generation = "completed";
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (setup.status === "not_started" && (config.python_packages?.length ?? 0) > 0) {
      setup = { status: "failed", packages: config.python_packages, error: failure };
      writeJson(join(config.artifacts, "setup.json"), setup);
    }
    if (/extension|flag|startup command/i.test(failure)) extensionStatus = "error";
    if (/timeout/i.test(budget.failure ?? "")) generation = "timeout";
    if (/termination signal/i.test(budget.failure ?? "")) generation = "cancelled";
    trace.emit("lead", "runtime_error", { error: failure });
  } finally {
    if (timer) clearTimeout(timer);
    await coordinator?.stop();
    try { await sessions?.close(); } catch (error) { failure = failure ?? String(error); generation = "failed"; }
    await mock?.close();
    if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = previousPythonPath;
    process.removeListener("SIGTERM", signalHandler);
    process.removeListener("SIGINT", signalHandler);
  }
  const observedTeam = coordinator?.summary() ?? { status: "not_applicable", errors: [] };
  const team = coordinator && config.workflow_validation === "off"
    ? { ...observedTeam, status: "not_checked", errors: [] } : observedTeam;
  const summary = { schema_version: 1, runtime_generation_status: generation, extension_status: extensionStatus,
    team, setup, error: failure, budget_error: budget.failure, role_budget_errors: budget.roleFailures, usage: { actors: budget.actors, total_tokens: budget.totalTokens,
      assistant_responses: budget.totalTurns, cost: null },
    actors: [...(sessions?.actors.values() ?? [])].map(actor => ({ id: actor.id, session_id: actor.session.sessionId,
      session_file: actor.session.sessionFile, settled: actor.settled, last_stop_reason: actor.lastStopReason, errors: actor.errors })),
    mock_requests: mock?.requests, mock_observations: mock?.observations, manifest_path: join(config.artifacts, "manifest.json") };
  writeJson(join(config.artifacts, "summary.json"), summary);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(readFileSync(process.argv[2] ?? "/runtime.json", "utf8")) as RuntimeConfig;
  const result = await runBenchmark(config);
  console.log(JSON.stringify(result));
  process.exitCode = result.runtime_generation_status === "completed" &&
    !(config.workflow_validation === "required" && result.team.status === "incomplete") ? 0 : 1;
}
