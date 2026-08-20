import { Hono } from "hono";
import { stream } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { Type } from "typebox";

// The wire shape of one SSE event as conformance tooling (Schemathesis) sees
// it: the event name plus the raw `data:` line as a string. The payload JSON
// is documented as a string because the event stream is a wire protocol, not
// a JSON document.
const SseEventSchema = Type.Object(
  {
    event: Type.String(),
    data: Type.String(),
  },
  { additionalProperties: false },
);

/**
 * SSE readiness (E1-02 end state): the route proves the stream transport and
 * its OpenAPI representation. Real subscription events arrive with later
 * tasks (E1-06 and beyond).
 */
export function eventsRoutes(): Hono {
  const app = new Hono();

  app.get(
    "/events",
    describeRoute({
      tags: ["events"],
      responses: {
        200: {
          description: "Server-sent event stream",
          content: {
            "text/event-stream": { schema: SseEventSchema },
          },
        },
      },
    }),
    (c) => {
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      return stream(c, async (s) => {
        for (const event of ["started", "heartbeat", "complete"]) {
          s.write(`event: ${event}\n`);
          s.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
          await s.sleep(25);
        }
      });
    },
  );

  return app;
}
