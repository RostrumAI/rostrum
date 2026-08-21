import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ControlApiApp } from "../app";

/**
 * Generates the OpenAPI document into apps/control-api/openapi.json without a
 * live server. The document is identical to the one served at /openapi.json
 * (a test asserts that parity), so the checked-in file is the stable contract
 * artifact and conformance tooling can consume it directly.
 */
const app = new ControlApiApp();
const response = await app.routes.fetch(new Request("http://localhost/openapi.json"));
if (!response.ok) {
  throw new Error(`openapi.json fetch failed: ${response.status}`);
}
const doc = await response.json();
const out = join(import.meta.dir, "../../openapi.json");
await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}`);
