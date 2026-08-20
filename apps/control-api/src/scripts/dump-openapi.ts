import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../app";
import { loadConfig } from "../config";
import { createLogger } from "../logger";

/**
 * Dumps the generated OpenAPI document to apps/control-api/openapi.json
 * without a live server. The document is identical to the one served at
 * /openapi.json (a test asserts that parity), so the checked-in file is the
 * stable contract artifact and conformance tooling can consume it directly.
 */
const config = loadConfig({});
const app = createApp({ logger: createLogger("error"), config });

const response = await app.fetch(new Request("http://localhost/openapi.json"));
if (!response.ok) {
  throw new Error(`openapi.json fetch failed: ${response.status}`);
}
const doc = await response.json();
const out = join(import.meta.dir, "../../openapi.json");
await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}`);
