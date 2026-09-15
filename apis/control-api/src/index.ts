/** @fileoverview Control API process entry point. */

import { join } from "node:path";
import { boot } from "@rostrum/server/lifecycle";
import { controlApiConfig } from "./config";
import { ControlApi } from "./control-api";

/** Starts the Control API from its configuration file and the process environment. */
await boot(join(import.meta.dir, ".."), controlApiConfig, ControlApi.open);
