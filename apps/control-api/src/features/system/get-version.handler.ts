import type { Context } from "hono";
import pkg from "../../../package.json" with { type: "json" };
import { INTERFACE_VERSION } from "../../schemas";

/** The service identity reported by the version route. */
export const SERVICE_NAME = "rostrum-control-api";

/** Serves GET /version: service identity and workflow interface version. */
export class GetVersionHandler {
  handle(c: Context) {
    return c.json({
      service: SERVICE_NAME,
      version: pkg.version,
      interfaceVersion: INTERFACE_VERSION,
    });
  }
}
