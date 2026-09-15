/** @fileoverview Daemon process entry point. */

import { boot } from "@rostrum/server/lifecycle";
import { daemonConfig } from "./config";
import { Daemon } from "./daemon";

/** Starts the daemon from its configuration file and the process environment. */
await boot(import.meta.dir, daemonConfig, Daemon.open);
