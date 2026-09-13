/** @fileoverview Control API contract generation command. */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ControlApiApp } from "../app";

/** Writes the same OpenAPI document served by the Control API. */
const app = await ControlApiApp.create();
const doc = await app.openApi();
const out = join(import.meta.dir, "../../openapi.json");
await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${out}`);
