export interface Role {
  name: string;
  prompt: string;
  tools: string[];
  start_after?: string[];
}

export interface RuntimeConfig {
  schema_version: 1;
  benchmark?: { revision: string | null; python_source_sha256: string };
  run_id: string;
  workspace: string;
  home: string;
  artifacts: string;
  mock: boolean;
  profile: "single" | "team";
  teammates: number;
  max_active_teammates: number;
  task_timeout_seconds: number;
  max_total_tokens: number | null;
  max_turns: number;
  max_messages: number;
  batch_file_writes?: boolean;
  compact_write_history?: boolean;
  python_packages?: string[];
  setup_timeout_seconds?: number;
  role_token_limits?: Record<string, number>;
  enforce_role_token_limits?: boolean;
  workflow_validation: "off" | "report" | "required";
  roles: Role[];
  extensions: { path: string; scope: "lead" | "members" | "all"; sha256?: Record<string, string> }[];
  extension_options: Record<string, boolean | string>;
  startup_commands: string[];
  model: {
    id: string;
    api: string;
    baseUrl: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    compat?: Record<string, unknown>;
    thinkingLevelMap?: Record<string, unknown>;
  };
}

export interface TeamMessage {
  id: string;
  sender: string;
  target: string;
  text: string;
  delivered: boolean;
}

export interface TeamTask {
  id: string;
  title: string;
  owner: string;
  status: "pending" | "in_progress" | "completed";
  write_scopes: string[];
}
