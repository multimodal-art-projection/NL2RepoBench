import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionFactory, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { fileBatchExtension } from "./extensions/files.js";
import { Budget, Trace } from "./events.js";
import type { RuntimeConfig } from "./types.js";

export interface ActorSession {
  id: string;
  session: AgentSession;
  errors: string[];
  lastStopReason?: string;
  settled: boolean;
  close(): Promise<void>;
}

export class Sessions {
  readonly actors = new Map<string, ActorSession>();
  onMessage?: (actor: string, message: unknown) => void;
  constructor(readonly config: RuntimeConfig, readonly models: ModelRuntime, readonly trace: Trace, readonly budget: Budget) {}

  async create(id: string, prompt: string, factories: ExtensionFactory[], tools?: string[], role = id): Promise<ActorSession> {
    const config = this.config;
    const batchFiles = config.batch_file_writes !== false;
    this.budget.register(id, role);
    const budgetExtension: ExtensionFactory = pi => {
      pi.on("context", event => {
        const notice = this.budget.notice(id);
        return notice ? { messages: [...event.messages, { role: "user" as const, content: notice, timestamp: Date.now() }] } : undefined;
      });
    };
    const extensions = [budgetExtension, ...(batchFiles ? [fileBatchExtension(config.workspace, id, this.trace, config.compact_write_history === true)] : []), ...factories];
    const directory = id === "lead" ? join(config.artifacts, "lead") : join(config.artifacts, "members", id);
    mkdirSync(directory, { recursive: true });
    const settings = SettingsManager.inMemory({ defaultProvider: "nl2repo", defaultModel: config.model.id,
      defaultProjectTrust: "never", retry: { enabled: true, maxRetries: 1, baseDelayMs: 10 },
      compaction: { enabled: true, reserveTokens: config.model.maxTokens, keepRecentTokens: 4096 } });
    const resourceLoader = new DefaultResourceLoader({ cwd: config.workspace, agentDir: config.home,
      settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true,
      noThemes: true, noContextFiles: true,
      additionalExtensionPaths: config.extensions.filter(ext => ext.scope === "all" || ext.scope === (id === "lead" ? "lead" : "members")).map(ext => ext.path),
      extensionFactories: extensions.map((factory, index): InlineExtension => ({ name: `nl2repo-${id}-${index}`, factory })),
      appendSystemPrompt: [`NL2REPO_ACTOR=${id}\n${prompt}`] });
    await resourceLoader.reload();
    const loaded = resourceLoader.getExtensions();
    if (loaded.errors.length) throw new Error("Extension loading failed: " + loaded.errors.map(x => `${x.path}: ${x.error}`).join("; "));
    const flags = new Map(loaded.extensions.flatMap(ext => [...ext.flags.entries()]));
    for (const [name, value] of Object.entries(config.extension_options)) {
      const flag = flags.get(name);
      // Flags scoped to other actors are validated by that actor's loader.
      if (!flag) {
        if (id === "lead" && !config.extensions.some(ext => ext.scope === "members")) throw new Error(`Unknown extension flag: ${name}`);
        continue;
      }
      if (typeof value !== flag.type) throw new Error(`Extension flag ${name} requires ${flag.type}`);
      loaded.runtime.flagValues.set(name, value);
    }
    const model = this.models.getModel("nl2repo", config.model.id);
    if (!model) throw new Error("Configured exact model is unavailable");
    const internal = new Set(["write_files", "start_team", "spawn_teammate", "wait_agent", "send_message", "team_task", "list_agents", "finish_teammate"]);
    const registered = loaded.extensions.flatMap(ext => [...ext.tools.keys()]);
    const controlTools = id === "lead" ? ["start_team", "spawn_teammate", "wait_agent", "send_message", "team_task", "list_agents"] : ["send_message", "team_task", "finish_teammate"];
    const active = tools ? [...new Set([...tools.map(tool => batchFiles && tool === "write" ? "write_files" : tool),
      ...controlTools.filter(name => registered.includes(name)), ...registered.filter(name => !internal.has(name))])] : undefined;
    const { session, modelFallbackMessage } = await createAgentSession({ cwd: config.workspace, agentDir: config.home,
      modelRuntime: this.models, model, thinkingLevel: config.model.thinking,
      settingsManager: settings, sessionManager: SessionManager.create(config.workspace, directory), resourceLoader,
      tools: active });
    if (modelFallbackMessage) throw new Error(modelFallbackMessage);
    if (batchFiles) session.setActiveToolsByName(session.getActiveToolNames().filter(name => name !== "write"));
    const actor: ActorSession = { id, session, errors: [], settled: false, close: async () => {
      await session.abort();
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
    } };
    this.actors.set(id, actor);
    this.budget.abortRole = roleName => {
      for (const item of this.actors.values()) if (this.budget.actorFailure(item.id) && !item.settled) void item.session.abort();
    };
    session.subscribe(event => {
      const data = event as unknown as Record<string, any>;
      if (event.type === "agent_start") actor.settled = false;
      if (event.type === "agent_settled") actor.settled = true;
      if (event.type === "message_end") {
        this.onMessage?.(id, data.message);
        if (data.message.role === "assistant") {
          actor.lastStopReason = data.message.stopReason;
          this.budget.add(id, data.message.usage ?? {});
        }
      }
      if (event.type === "compaction_end" && data.result?.usage) this.budget.add(id, data.result.usage, true);
      if (event.type === "message_update") {
        this.trace.emit(id, event.type, { assistantMessageEvent: data.assistantMessageEvent.type,
          delta: data.assistantMessageEvent.delta });
      } else this.trace.emit(id, event.type, data);
    });
    const fixedIdentity = async (): Promise<never> => { throw new Error("Session replacement is disabled in fixed-identity benchmark runs; use a new benchmark job"); };
    await session.bindExtensions({ mode: "json", commandContextActions: { waitForIdle: () => session.waitForIdle(),
      newSession: fixedIdentity, fork: fixedIdentity, navigateTree: fixedIdentity, switchSession: fixedIdentity,
      reload: fixedIdentity },
      onError: error => { actor.errors.push(error.error); this.trace.emit(id, "extension_error", error); this.budget.fail("Required extension error"); } });
    this.trace.emit(id, "actor_created", { session_id: session.sessionId, session_file: session.sessionFile,
      extensions: loaded.extensions.map(ext => ext.path), flags: [...flags.keys()], tools: session.getActiveToolNames(),
      model: { provider: session.model?.provider, id: session.model?.id }, thinking: session.thinkingLevel });
    return actor;
  }

  async abortAll(): Promise<void> { await Promise.allSettled([...this.actors.values()].map(actor => actor.session.abort())); }
  async close(): Promise<void> {
    // Members first: the lead may have a shutdown hook depending on their final state.
    for (const actor of [...this.actors.values()].reverse()) await actor.close();
    await this.models.settleCredentialWrites();
  }
}
