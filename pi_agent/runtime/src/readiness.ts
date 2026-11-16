import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createFindTool, createGrepTool, createLsTool } from "@earendil-works/pi-coding-agent";

/** Check the real tool implementations before allowing any live model requests. */
export async function verifyRuntimeTools(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "nl2repo-readiness-"));
  try {
    writeFileSync(join(root, "sample.py"), "needle = 42\n");
    const signal = AbortSignal.timeout(10000);
    const found = await createFindTool(root).execute("readiness-find", { pattern: "*.py" }, signal);
    const grepped = await createGrepTool(root).execute("readiness-grep", { pattern: "needle" }, signal);
    const listed = await createLsTool(root).execute("readiness-ls", {}, signal);
    assert.match(JSON.stringify(found.content), /sample\.py/);
    assert.match(JSON.stringify(grepped.content), /needle/);
    assert.match(JSON.stringify(listed.content), /sample\.py/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyRuntimeTools();
  console.log("Runtime find/grep/ls checks passed without model requests.");
}
