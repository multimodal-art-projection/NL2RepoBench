import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeConfig } from "./types.js";

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export class Trace {
  private sequence = 0;
  constructor(readonly config: RuntimeConfig) {
    mkdirSync(config.artifacts, { recursive: true });
    if (config.profile === "team") appendFileSync(join(config.artifacts, "team-events.jsonl"), "");
  }

  emit(actor: string, type: string, data: unknown = {}, team = false): void {
    const directory = actor === "lead" ? join(this.config.artifacts, "lead") : join(this.config.artifacts, "members", actor);
    mkdirSync(directory, { recursive: true });
    const event = { schema_version: 1, run_id: this.config.run_id, event_id: randomUUID(),
      sequence: ++this.sequence, timestamp: new Date().toISOString(), actor_id: actor, type, data };
    const line = JSON.stringify(event) + "\n";
    appendFileSync(team ? join(this.config.artifacts, "team-events.jsonl") : join(directory, "events.jsonl"), line);
  }
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  responses: number;
  auxiliary: number;
  cost: null;
}

export class Budget {
  readonly actors: Record<string, UsageTotals> = {};
  failure?: string;
  abort?: () => void;
  abortRole?: (role: string) => void;
  readonly roleFailures: Record<string, string> = {};
  private readonly roles = new Map<string, string>();

  register(actor: string, role: string): void { this.roles.set(actor, role); }
  roleUsage(role: string): number {
    return Object.entries(this.actors).filter(([id]) => this.roles.get(id) === role).reduce((n, [, row]) => n + row.total, 0);
  }
  actorFailure(actor: string): string | undefined { return this.roleFailures[this.roles.get(actor) ?? actor]; }
  notice(actor: string): string | undefined {
    const role = this.roles.get(actor) ?? actor;
    const limit = this.config.role_token_limits?.[role];
    const used = this.roleUsage(role);
    return limit && used >= limit * 0.8 ? `Role token ${this.config.enforce_role_token_limits === true ? "ceiling" : "handoff target (advisory)"}: ${used}/${limit}; shared usage ${this.totalTokens}/${this.config.max_total_tokens ?? "uncapped"}. Prioritize a truthful finish_teammate handoff now. Report status=incomplete if work remains; do not claim unfinished work is completed.` : undefined;
  }
  constructor(readonly config: RuntimeConfig) {}

  fail(reason: string): void {
    if (this.failure) return;
    this.failure = reason;
    queueMicrotask(() => this.abort?.());
  }

  add(actor: string, usage: Record<string, unknown>, auxiliary = false): void {
    const row = this.actors[actor] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0,
      responses: 0, auxiliary: 0, cost: null };
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) row[key] += value;
    }
    const sum = ["input", "output", "cacheRead", "cacheWrite"].reduce((n, key) => n + (Number(usage[key]) || 0), 0);
    row.total += typeof usage.totalTokens === "number" ? usage.totalTokens : sum;
    if (auxiliary) row.auxiliary++; else row.responses++;
    if (this.config.max_total_tokens !== null && this.totalTokens >= this.config.max_total_tokens) this.fail("Shared token budget exhausted");
    if (this.totalTurns >= this.config.max_turns) this.fail("Shared turn budget exhausted");
    const role = this.roles.get(actor);
    const limit = role && this.config.role_token_limits?.[role];
    if (this.config.enforce_role_token_limits === true && !this.failure && role && limit && this.roleUsage(role) >= limit && !this.roleFailures[role]) {
      this.roleFailures[role] = `Role token budget exhausted: ${role} (${this.roleUsage(role)}/${limit})`;
      queueMicrotask(() => this.abortRole?.(role));
    }
  }

  get totalTokens(): number { return Object.values(this.actors).reduce((n, row) => n + row.total, 0); }
  get totalTurns(): number { return Object.values(this.actors).reduce((n, row) => n + row.responses, 0); }
  check(): void { if (this.failure) throw new Error(this.failure); }
}
