import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function probe(pi: ExtensionAPI) {
  let mode = false;
  pi.registerFlag("probe-label", { description: "Contract test option", type: "string", default: "default-label" });
  pi.on("session_start", (_event, ctx) => {
    appendFileSync(join(ctx.cwd, "lifecycle.log"), `start hasUI=${ctx.hasUI}\n`);
    pi.appendEntry("probe-start", { label: pi.getFlag("probe-label") });
  });
  pi.registerCommand("probe-mode", { description: "Enable a noninteractive custom mode", handler: async () => { mode = true; } });
  pi.on("before_agent_start", event => mode ? { systemPrompt: event.systemPrompt + "\nContract mode is active." } : undefined);
  pi.registerTool({ name: "contract_probe", label: "Contract probe", description: "Exercise an extension-defined tool.",
    parameters: Type.Object({ value: Type.String() }),
    execute: async (_id, params, _signal, _update, ctx) => {
      const data = { value: params.value, label: pi.getFlag("probe-label"), mode };
      writeFileSync(join(ctx.cwd, "probe.json"), JSON.stringify(data));
      return { content: [{ type: "text", text: JSON.stringify(data) }], details: data };
    } });
  pi.on("session_shutdown", (_event, ctx) => { appendFileSync(join(ctx.cwd, "lifecycle.log"), "shutdown\n"); });
}
