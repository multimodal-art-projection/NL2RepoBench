import { appendFileSync, mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import type { RuntimeConfig } from "./types.js";

export async function prepareEnvironment(config: RuntimeConfig): Promise<{ status: string; packages: string[]; target?: string }> {
  const packages = config.python_packages ?? [];
  if (!packages.length) return { status: "not_required", packages };
  const target = join(config.home, "python-deps");
  mkdirSync(target, { recursive: true });
  const log = join(config.artifacts, "setup.log");
  const env: NodeJS.ProcessEnv = { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: "1" };
  delete env.NL2REPO_MODEL_API_KEY;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("python", ["-m", "pip", "install", "--no-input", "--no-warn-script-location", "--target", target, ...packages],
      { env, signal: AbortSignal.timeout((config.setup_timeout_seconds ?? 120) * 1000) });
    child.stdout.on("data", data => appendFileSync(log, data));
    child.stderr.on("data", data => appendFileSync(log, data));
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Python dependency setup failed (exit ${code}); see setup.log`)));
  });
  process.env.PYTHONPATH = [target, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
  return { status: "completed", packages, target };
}
