import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../app";
import { loadConfig } from "../config";
import { createMemoryWorkflowRepo } from "../db/workflows-repo";
import { createLogger } from "../logger";

/**
 * Dumps the generated OpenAPI document to apps/control-api/openapi.json
 * without a live server. The document is identical to the one served at
 * /openapi.json (a test asserts that parity), so the typed client can be
 * generated from the checked-in file in CI.
 */
const config = loadConfig();
const app = createApp({
  repo: createMemoryWorkflowRepo(),
  logger: createLogger("error"),
  config,
});

const response = await app.fetch(new Request("http://localhost/openapi.json"));
if (!response.ok) {
  throw new Error(`openapi.json fetch failed: ${response.status}`);
}
const doc = await response.json();
const out = join(import.meta.dir, "../../openapi.json");
await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}`);
