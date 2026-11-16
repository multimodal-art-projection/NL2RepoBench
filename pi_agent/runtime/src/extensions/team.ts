import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ActorSession, Sessions } from "../session.js";
import type { RuntimeConfig, TeamMessage, TeamTask } from "../types.js";
import type { Budget, Trace } from "../events.js";

interface Member {
  id: string;
  role: string;
  task: string;
  actor: ActorSession;
  initial: boolean;
  running: boolean;
  finished: boolean;
  report?: string;
  error?: string;
  pending: TeamMessage[];
  reportReminders: number;
}

const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });

export class Coordinator {
  readonly members = new Map<string, Member>();
  readonly tasks = new Map<string, TeamTask>();
  readonly messages = new Map<string, TeamMessage>();
  readonly leadPending: TeamMessage[] = [];
  private active = 0;
  private closing = false;
  private reminders = 0;
  private readonly runs = new Set<Promise<void>>();
  private readonly reserved = new Set<string>();
  private readonly deadline: number;
  constructor(readonly config: RuntimeConfig, readonly sessions: Sessions, readonly trace: Trace, readonly budget: Budget) {
    this.deadline = Date.now() + config.task_timeout_seconds * 1000;
    sessions.onMessage = (actor, message) => {
      const data = message as { role?: string; customType?: string; details?: { message_id?: string } };
      if (data.role === "custom" && data.customType === "nl2repo-team-message" && data.details?.message_id) {
        const item = this.messages.get(data.details.message_id);
        if (item && item.target === actor && !item.delivered) {
          item.delivered = true;
          this.event(actor, "message_delivered", { message_id: item.id, sender: item.sender, target: actor });
        }
      }
    };
  }

  private event(actor: string, type: string, data: unknown): void { this.trace.emit(actor, type, data, true); }

  async spawn(name: string, roleName: string, task: string): Promise<unknown> {
    this.budget.check();
    if (this.closing) throw new Error("Team is shutting down");
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || name === "lead" || this.reserved.has(name)) throw new Error("Invalid or duplicate teammate name");
    if (this.reserved.size >= this.config.teammates) throw new Error("Configured teammate limit reached");
    const role = this.config.roles.find(item => item.name === roleName);
    if (!role || !task.trim()) throw new Error("Unknown role or empty delegated task");
    // Reserve synchronously: a model may issue several spawn tool calls concurrently.
    this.reserved.add(name);
    let actor: ActorSession;
    try { actor = await this.sessions.create(name, role.prompt, [this.extension(name)], role.tools, roleName); }
    catch (error) { this.reserved.delete(name); throw error; }
    const member: Member = { id: name, role: roleName, task, actor, initial: true, running: false,
      finished: false, reportReminders: 0, pending: [...this.messages.values()].filter(item => item.target === name && !item.delivered) };
    this.members.set(name, member);
    this.event("lead", "member_created", { id: name, role: roleName, session_id: actor.session.sessionId, task });
    if (![...this.tasks.values()].some(item => item.owner === name)) {
      this.task("lead", { action: "create", id: `assignment-${name}`, title: task.slice(0, 120), owner: name });
    }
    // Real assignment messages enter each recipient's native context before work.
    this.send("lead", name, `Delegated assignment: ${task}`);
    for (const prerequisite of this.members.values()) {
      if (prerequisite.finished && prerequisite.report && role.start_after?.includes(prerequisite.role)) {
        this.send(prerequisite.id, name, prerequisite.report);
      }
    }
    this.pump();
    return { id: name, status: "created" };
  }

  async startTeam(specifications: { name: string; role: string; task: string; write_scopes?: string[] }[]): Promise<unknown> {
    if (this.reserved.size || specifications.length !== this.config.teammates) throw new Error("Start the complete configured team once, before spawning members");
    const names = new Set<string>();
    for (const item of specifications) {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(item.name) || item.name === "lead" || names.has(item.name) ||
          !this.config.roles.some(role => role.name === item.role) || !item.task.trim()) throw new Error("Invalid team assignment");
      names.add(item.name);
    }
    for (const item of specifications) this.task("lead", { action: "create", id: `assignment-${item.name}`, title: item.task.slice(0, 120), owner: item.name, write_scopes: item.write_scopes });
    return await Promise.all(specifications.map(item => this.spawn(item.name, item.role, item.task)));
  }

  private deliver(actor: ActorSession, message: TeamMessage, triggerTurn = true): Promise<void> {
    return actor.session.sendCustomMessage({ customType: "nl2repo-team-message",
      content: `Message ${message.id} from ${message.sender}: ${message.text}`,
      display: false, details: { message_id: message.id, sender: message.sender } },
      { triggerTurn, deliverAs: "steer" });
  }

  send(sender: string, target: string, text: string): unknown {
    this.budget.check();
    if (this.closing || sender === target || !text.trim() || text.length > 16000) throw new Error("Invalid team message");
    const futureRole = this.reserved.size < this.config.teammates && this.config.roles.some(role => role.name === target);
    if (target !== "lead" && !this.members.has(target) && !this.reserved.has(target) && !futureRole) {
      throw new Error(`Unknown recipient: ${target}`);
    }
    if (this.messages.size >= this.config.max_messages) throw new Error("Shared team message limit reached");
    const message: TeamMessage = { id: `message-${this.messages.size + 1}`, sender, target, text, delivered: false };
    this.messages.set(message.id, message);
    this.event(sender, "message_queued", message);
    const member = this.members.get(target);
    const actor = target === "lead" ? this.sessions.actors.get("lead") : member?.actor;
    if (member) member.finished = false;
    if (actor?.session.isStreaming) {
      void this.deliver(actor, message).catch(error => {
        if (member) member.error = String(error);
        this.budget.fail("Team message delivery failed");
      });
    } else if (target === "lead") this.leadPending.push(message);
    else if (member) { member.pending.push(message); this.pump(); }
    // A message to a configured role not yet spawned stays queued until creation.
    return { message_id: message.id, status: "queued" };
  }

  private pump(): void {
    if (this.closing || this.budget.failure) return;
    for (const member of this.members.values()) {
      if (this.active >= this.config.max_active_teammates) return;
      if (member.running || member.error || (!member.initial && !member.pending.length)) continue;
      if (member.initial) {
        const dependencies = this.config.roles.find(role => role.name === member.role)?.start_after ?? [];
        const prerequisites = [...this.members.values()].filter(other => dependencies.includes(other.role));
        if (prerequisites.some(other => other.error)) {
          member.error = "Prerequisite teammate failed before handoff";
          this.event(member.id, "member_failed", { id: member.id, error: member.error });
          continue;
        }
        if (dependencies.some(role => !prerequisites.some(other => other.role === role)) ||
            prerequisites.some(other => !other.finished || other.running)) continue;
      }
      member.running = true;
      this.active++;
      const operation = this.run(member).finally(() => {
        member.running = false; this.active--; this.runs.delete(operation); this.pump();
      });
      this.runs.add(operation);
    }
  }

  private async run(member: Member): Promise<void> {
    try {
      this.budget.check();
      let operation: Promise<unknown>;
      if (member.initial) {
        member.initial = false;
        this.event(member.id, "member_started", { id: member.id, role: member.role });
        // Put the handoff and lead follow-up in the initial context, without extra turns.
        for (const message of member.pending.splice(0)) await this.deliver(member.actor, message, false);
        operation = member.actor.session.prompt(member.task, { source: "extension" });
      } else {
        member.finished = false;
        const pending = member.pending.splice(0);
        if (!pending.length) return;
        for (const message of pending) await this.deliver(member.actor, message, false);
        operation = member.actor.session.prompt("Address the queued team messages, then update your completion report. Batch related tool calls.", { source: "extension" });
      }
      await operation;
      if (["error", "aborted", "length"].includes(member.actor.lastStopReason ?? "")) {
        throw new Error(this.budget.actorFailure(member.id) ?? `Teammate response ended with ${member.actor.lastStopReason}`);
      }
      if (!member.finished && !member.error && !member.pending.length) {
        throw new Error("Teammate settled without the required finish_teammate report");
      }
      this.event(member.id, "member_idle", { id: member.id, finished: member.finished });
    } catch (error) {
      member.error = String(error);
      this.event(member.id, "member_failed", { id: member.id, error: member.error });
    }
  }

  list(): unknown[] {
    return [...this.members.values()].map(member => ({ id: member.id, role: member.role,
      state: member.error ? "failed" : member.running ? "running" : member.initial ? "waiting" : member.finished ? "completed" : "idle",
      session_id: member.actor.session.sessionId, pending_messages: [...this.messages.values()].filter(m => m.target === member.id && !m.delivered).length,
      report: member.report, error: member.error }));
  }

  async wait(target: string, _timeout?: number, signal?: AbortSignal): Promise<unknown> {
    if (target !== "all" && !this.members.has(target)) throw new Error("Unknown teammate");
    // The benchmark deadline bounds this wait. A ten-second status timeout used to
    // force repeated full-context model requests while workers were still producing code.
    // Keep timeout_ms accepted for old clients, but never use it for status polling.
    const selected = () => target === "all" ? [...this.members.values()] : [this.members.get(target)!];
    while (selected().some(member => !member.error && (member.running || member.initial || member.pending.length))) {
      this.budget.check();
      if (signal?.aborted) throw new Error("Wait aborted");
      if (Date.now() >= this.deadline) throw new Error("Team wait reached task execution timeout");
      await delay(25, undefined, { signal });
    }
    this.budget.check();
    return target === "all" ? this.list() : this.list().find(item => (item as { id: string }).id === target);
  }

  task(actor: string, params: { action: string; id?: string; title?: string; owner?: string; status?: string; write_scopes?: string[] }): unknown {
    if (params.action === "list") return [...this.tasks.values()];
    const id = params.id;
    if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("A valid task id is required");
    if (params.action === "create") {
      if (this.tasks.has(id) || !params.title) throw new Error("Task already exists or has no title");
      const task: TeamTask = { id, title: params.title, owner: params.owner ?? actor,
        status: "pending", write_scopes: params.write_scopes ?? [] };
      this.tasks.set(id, task); this.event(actor, "task_updated", task); return task;
    }
    const task = this.tasks.get(id);
    if (!task || (actor !== "lead" && task.owner !== actor)) throw new Error("Only the task owner or lead may update this task");
    if (!["pending", "in_progress", "completed"].includes(params.status ?? "")) throw new Error("Invalid task status");
    task.status = params.status as TeamTask["status"];
    this.event(actor, "task_updated", task); return task;
  }

  finish(actor: string, report: string, status: "completed" | "incomplete" = "completed"): unknown {
    this.budget.check();
    const member = this.members.get(actor);
    if (!member || !report.trim() || report.length > 12000) throw new Error("Only a teammate can submit a concise nonempty final report");
    const recipients = ["lead", ...[...this.members.values()].filter(other => other.id !== actor &&
      (this.config.roles.find(role => role.name === other.role)?.start_after ?? []).includes(member.role)).map(other => other.id)];
    if (this.messages.size + recipients.length > this.config.max_messages) throw new Error("Shared team message limit reached");
    const completed: string[] = [];
    if (status === "completed") {
      // The tool contract makes this an explicit completion declaration by the actor.
      for (const task of this.tasks.values()) if (task.owner === actor && task.status !== "completed") {
        this.task(actor, { action: "update", id: task.id, status: "completed" }); completed.push(task.id);
      }
      member.finished = true;
    } else {
      member.error = `Teammate reported incomplete: ${report}`;
      member.finished = false;
    }
    member.report = report;
    const messages = recipients.map(target => this.send(actor, target, `${status === "completed" ? "Completed handoff" : "Incomplete work report"}: ${report}`));
    this.event(actor, status === "completed" ? "member_finished" : "member_incomplete", { id: actor, report, completed_tasks: completed });
    return { status: "reported", outcome: status, completed_tasks: completed, messages,
      next_action: "Your assigned pass is complete. End your turn now; record known test failures in the report instead of starting more repairs." };
  }

  extension(actor: string): ExtensionFactory {
    return (pi: ExtensionAPI) => {
      pi.registerTool({ name: "send_message", label: "Send team message", description: "Send a follow-up to the lead or a named teammate. Queued is not yet delivered.",
        parameters: Type.Object({ target: Type.String(), text: Type.String() }),
        execute: async (_id, params) => result(this.send(actor, params.target, params.text)) });
      pi.registerTool({ name: "list_agents", label: "List teammates", description: "Inspect teammate lifecycle, pending messages, and reports.",
        parameters: Type.Object({}), execute: async () => result(this.list()) });
      pi.registerTool({ name: "team_task", label: "Shared task board", description: "Create, list, or update shared tasks. Coordinate ownership and advisory file scopes.",
        parameters: Type.Object({ action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("update")]),
          id: Type.Optional(Type.String()), title: Type.Optional(Type.String()), owner: Type.Optional(Type.String()),
          status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")])),
          write_scopes: Type.Optional(Type.Array(Type.String())) }),
        execute: async (_id, params) => result(this.task(actor, params)) });
      if (actor === "lead") {
        pi.registerTool({ name: "start_team", label: "Start team assignments", description: `Create all ${this.config.teammates} configured teammates and their owned task-board items in one call. Delegation messages are delivered to their persistent sessions automatically.`,
          parameters: Type.Object({ members: Type.Array(Type.Object({ name: Type.String(), role: Type.String(), task: Type.String(), write_scopes: Type.Optional(Type.Array(Type.String())) }), { minItems: this.config.teammates, maxItems: this.config.teammates }) }),
          execute: async (_id, params) => result(await this.startTeam(params.members)) });
        pi.registerTool({ name: "spawn_teammate", label: "Spawn teammate", description: `Create one persistent teammate. Limit ${this.config.teammates}; roles: ${this.config.roles.map(r => r.name).join(", ")}.`,
          parameters: Type.Object({ name: Type.String(), role: Type.String(), task: Type.String() }),
          execute: async (_id, params) => result(await this.spawn(params.name, params.role, params.task)) });
        pi.registerTool({ name: "wait_agent", label: "Wait for teammate", description: "Block until queued teammate work settles, bounded by the task deadline. Use target=all after delegation. No status polling or model requests occur during the wait. Legacy timeout_ms does not shorten the wait.",
          parameters: Type.Object({ target: Type.String({ description: "Teammate name, or all to wait for the whole team" }), timeout_ms: Type.Optional(Type.Integer({ minimum: 1 })) }),
          execute: async (_id, params, signal) => result(await this.wait(params.target, params.timeout_ms ?? 1000, signal)) });
        pi.on("agent_before_settle", async event => {
          if (this.reminders >= 2 || this.budget.failure || this.members.size !== this.config.teammates) return;
          if ([...this.members.values()].some(m => !m.finished || m.running) || [...this.messages.values()].some(m => !m.delivered)) {
            this.reminders++;
            return { entries: [...event.entries, { type: "custom_message" as const, customType: "team-reminder",
              content: "Use wait_agent with target=all to await required teammate reports without polling. Address outstanding messages and finish the task board before finishing.", display: false }], continue: true };
          }
        });
      } else {
        pi.on("agent_before_settle", event => {
          const member = this.members.get(actor);
          if (!member || member.finished || member.error || this.budget.failure || member.reportReminders >= 2) return;
          member.reportReminders++;
          return { entries: [...event.entries, { type: "custom_message" as const, customType: "report-reminder",
            content: "Submit finish_teammate before ending. Report the repository files and known check failures honestly. Failed tests do not prevent completing your implementation/review pass; use incomplete only if required work was not attempted or files are missing.", display: false }], continue: true };
        });
        pi.registerTool({ name: "finish_teammate", label: "Submit teammate report", description: "One handoff action: declare owned work completed, complete owned task-board items, send your report to the lead and dependent reviewer, and submit your final report. No separate messages or board updates are needed. Known failing tests are valid findings and do not prevent reporting a completed pass. Use status=incomplete honestly if required work was not attempted or source files are missing. Follow-ups may still arrive.",
          parameters: Type.Object({ report: Type.String(), status: Type.Optional(Type.Union([Type.Literal("completed"), Type.Literal("incomplete")])) }), execute: async (_id, params) => result(this.finish(actor, params.report, params.status)) });
      }
    };
  }

  async drain(): Promise<void> {
    const deadline = this.deadline;
    for (let round = 0; round < 4; round++) {
      while ([...this.members.values()].some(m => !m.error && (m.running || m.initial || m.pending.length))) {
        this.budget.check();
        if (Date.now() >= deadline) throw new Error("Team did not drain before completion deadline");
        await delay(10);
      }
      const lead = this.sessions.actors.get("lead");
      const pending = this.leadPending.splice(0);
      if (!pending.length || !lead) return;
      const operation = this.deliver(lead, pending[0]);
      for (const message of pending.slice(1)) await this.deliver(lead, message);
      await operation;
    }
    throw new Error("Team exceeded message-drain continuation limit");
  }

  async stop(): Promise<void> {
    this.closing = true;
    await this.sessions.abortAll();
    await Promise.allSettled([...this.runs]);
  }

  summary(): { status: string; errors: string[]; members: unknown[]; tasks: TeamTask[]; queued_messages: number; delivered_messages: number; peer_messages: number } {
    const errors: string[] = [];
    if (this.members.size !== this.config.teammates) errors.push(`Expected ${this.config.teammates} teammates; found ${this.members.size}`);
    for (const member of this.members.values()) {
      if (member.error || !member.finished || member.running || !member.actor.settled || member.actor.errors.length) errors.push(`Teammate ${member.id} did not finish successfully`);
      for (const [sender, target] of [["lead", member.id], [member.id, "lead"]]) {
        if (![...this.messages.values()].some(m => m.delivered && m.sender === sender && m.target === target)) errors.push(`Missing delivered exchange ${sender} -> ${target}`);
      }
    }
    const messages = [...this.messages.values()];
    const peers = messages.filter(m => m.delivered && m.sender !== "lead" && m.target !== "lead").length;
    if (!peers) errors.push("No delivered peer message");
    if (messages.some(m => !m.delivered)) errors.push("Undelivered team messages remain");
    if (!this.tasks.size || [...this.tasks.values()].some(task => task.status !== "completed")) errors.push("Task board is empty or incomplete");
    return { status: errors.length ? "incomplete" : "completed", errors, members: this.list(), tasks: [...this.tasks.values()],
      queued_messages: messages.length, delivered_messages: messages.filter(m => m.delivered).length, peer_messages: peers };
  }
}
