/** @fileoverview Daemon contract generation command. */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createDaemonApp } from "../http/app";

const app = createDaemonApp();
await writeFile(
    join(import.meta.dir, "../../openapi.json"),
    `${JSON.stringify(await app.generateOpenApiDocument(), null, 2)}\n`,
);
