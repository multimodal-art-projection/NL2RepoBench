import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { createWriteTool, type ContextEvent, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Trace } from "../events.js";

export type FileWrite = { path: string; content: string };
const digest = (content: string) => createHash("sha256").update(content).digest("hex");


export async function writeFiles(workspace: string, files: FileWrite[], signal?: AbortSignal): Promise<unknown> {
  if (!files.length || files.length > 64) throw new Error("write_files requires 1 to 64 files");
  const root = resolve(workspace);
  const seen = new Set<string>();
  // Validate every path before writing any file. Never traverse generated symlinks.
  const prepared = files.map(file => {
    if (!file.path.trim() || typeof file.content !== "string") throw new Error("Each file requires path and content");
    if (file.content.trim().startsWith("[Written file body omitted from request history;") || file.content.trim().startsWith("Previously completed file write receipts:")) {
      throw new Error("File content is a history omission marker. Provide the actual complete source, not a receipt or placeholder.");
    }
    const target = resolve(root, file.path);
    const local = relative(root, target);
    if (!local || isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Write path must be inside the workspace");
    if (seen.has(target)) throw new Error("Duplicate write path in batch");
    seen.add(target);
    let current = root;
    for (const part of local.split(sep)) {
      current = resolve(current, part);
      try { if (lstatSync(current).isSymbolicLink()) throw new Error("Write path must not traverse a symlink"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { ...file, path: target, local };
  });
  const receipts: { path: string; bytes: number; sha256: string }[] = [];
  const tool = createWriteTool(root);
  for (const file of prepared) {
    if (signal?.aborted) throw new Error("Batch write aborted");
    try { await tool.execute(`batch-${receipts.length}`, { path: file.path, content: file.content }, signal); }
    catch (error) { throw new Error(`Write failed at ${file.local}; already written: ${receipts.map(r => r.path).join(", ") || "none"}; ${String(error)}`); }
    receipts.push({ path: file.local, bytes: Buffer.byteLength(file.content), sha256: digest(file.content) });
  }
  return { file_count: receipts.length, files: receipts };
}

/** Transform only provider context. Native sessions and normalized events retain originals. */
export function compactWriteHistory(messages: ContextEvent["messages"]): { messages: ContextEvent["messages"]; removedChars: number } {
  const successful = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult" && !message.isError) successful.add(message.toolCallId);
  }
  const elided = new Set<string>();
  const summaries = messages.map(message => {
    if (message.role !== "assistant") return message;
    return { ...message, content: message.content.map(part => {
      if (part.type !== "toolCall" || !successful.has(part.id)) return part;
      const args = part.arguments;
      const files = part.name === "write" && typeof args.content === "string" ? [{ path: args.path, content: args.content }]
        : part.name === "write_files" && Array.isArray(args.files) ? args.files as FileWrite[] : [];
      if (!files.length || files.some(file => typeof file.content !== "string") || files.reduce((n, file) => n + file.content.length, 0) < 1024) return part;
      const receipts = files.map(file => ({ path: file.path, bytes: Buffer.byteLength(file.content), sha256: digest(file.content) }));
      elided.add(part.id);
      // Summarize the entire completed call/result pair. Never put an omission
      // marker in a tool argument: live models can imitate that as new file content.
      return { type: "text" as const, text: `Previously completed file write receipts: ${JSON.stringify(receipts)}. Full source is on disk and in session logs. Use read to inspect it; new writes require actual complete source.` };
    }) };
  });
  const compacted = summaries.filter(message => message.role !== "toolResult" || !elided.has(message.toolCallId));
  return { messages: compacted, removedChars: Math.max(0, JSON.stringify(messages).length - JSON.stringify(compacted).length) };
}

export function fileBatchExtension(workspace: string, actor: string, trace: Trace, compactHistory = false): ExtensionFactory {
  return pi => {
    pi.registerTool({ name: "write_files", label: "Write repository files", description: "Create or replace multiple UTF-8 repository files in ONE call. Include package entry points, code, configuration and docs together; split only when the output limit requires it. Parent directories are created. Returns short path/byte/hash receipts. Accepts one file for later fixes.",
      promptSnippet: "Write several repository files in one call, returning concise receipts.",
      promptGuidelines: ["Use write_files to batch repository creation; avoid one response per small file.", "New files always require actual complete source, never a receipt or omission marker. Use read when you need current file content."],
      parameters: Type.Object({ files: Type.Array(Type.Object({ path: Type.String(), content: Type.String({ description: "Actual complete UTF-8 file content. Never a receipt, hash, or omission placeholder." }) }), { minItems: 1, maxItems: 64 }) }),
      execute: async (_id, params, signal) => {
        const receipt = await writeFiles(workspace, params.files, signal);
        return { content: [{ type: "text", text: JSON.stringify(receipt) }], details: receipt };
      } });
    if (compactHistory) pi.on("context", event => {
      const compacted = compactWriteHistory(event.messages);
      if (compacted.removedChars) trace.emit(actor, "write_history_compacted", { removed_characters: compacted.removedChars });
      return { messages: compacted.messages };
    });
  };
}
