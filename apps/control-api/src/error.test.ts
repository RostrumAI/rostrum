import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler, notFoundHandler, registerMethodNotAllowed } from "./error";
import { createLogger } from "./logger";

/** One error response in the single error shape (E1-02 contract). */
interface ErrorBody {
  code: string;
  message: string;
  findings: unknown[];
}

function makeApp() {
  const app = new Hono();
  app.get("/things", (c) => c.json({ ok: true }));
  app.post("/things", (c) => c.json({ created: true }));
  app.notFound(notFoundHandler);
  registerMethodNotAllowed(app);
  return app;
}

async function errorBody(res: Response): Promise<ErrorBody> {
  return (await res.json()) as ErrorBody;
}

describe("error shape (E1-02 contract)", () => {
  test("unknown routes return 404 with the error shape", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
    const body = await errorBody(res);
    expect(body.code).toBe("not_found");
    expect(body.findings).toEqual([]);
    expect(body.message).toContain("/nope");
  });

  test("disallowed methods return 405 with Allow and the error shape", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/things", { method: "PUT" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, POST");
    const body = await errorBody(res);
    expect(body.code).toBe("method_not_allowed");
    expect(body.findings).toEqual([]);
  });

  test("GET-only routes advertise GET and HEAD and reject other methods", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/things", { method: "DELETE" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD, POST");
  });

  test("HEAD works on a GET route (Hono maps HEAD to GET)", async () => {
    const res = await makeApp().fetch(new Request("http://localhost/things", { method: "HEAD" }));
    expect(res.status).toBe(200);
  });

  test("handler failures return 500 with the error shape and are logged", async () => {
    const lines: string[] = [];
    const logger = createLogger("error", (line) => lines.push(line));
    const app = new Hono();
    app.get("/boom", () => {
      throw new Error("boom");
    });
    app.onError(errorHandler(logger));

    const res = await app.fetch(new Request("http://localhost/boom"));
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(body.code).toBe("internal_error");
    expect(body.message).toBe("Internal Server Error");
    expect(body.findings).toEqual([]);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.msg).toBe("handler failed");
    expect(entry.error).toContain("boom");
    expect(entry.path).toBe("/boom");
  });
});
