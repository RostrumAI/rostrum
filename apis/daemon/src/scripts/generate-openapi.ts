import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonApp } from "../app";

const app = await DaemonApp.create();
await writeFile(
    join(import.meta.dir, "../../openapi.json"),
    `${JSON.stringify(await app.openApi(), null, 2)}\n`,
);
