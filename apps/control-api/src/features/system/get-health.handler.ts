import type { Context } from "hono";

/** Serves GET /health: reports service liveness. */
export class GetHealthHandler {
  handle(c: Context) {
    return c.json({ status: "ok" as const });
  }
}
