/** @fileoverview Control API contract generation command. */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createControlApiApp } from "../http/app";

/** Writes the same OpenAPI document the served Control API returns. */
await writeFile(
    join(import.meta.dir, "../../openapi.json"),
    `${JSON.stringify(await createControlApiApp().generateOpenApiDocument(), null, 2)}\n`,
);
