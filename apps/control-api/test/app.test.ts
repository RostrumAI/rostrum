import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkflowSchema, workflowDigest } from "@rostrum/workflow-lib";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createMemoryWorkflowRepo } from "../src/db/workflows-repo";
import { createLogger } from "../src/logger";

// Shared assertions: the same checks run over app.fetch() (row 4a) and over
// the real process (row 4b, server.test.ts).
export const validWorkflow = {
  interfaceVersion: "v1",
  id: "wf-hello",
  name: "Hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  start: "say",
  steps: [
    { id: "say", type: "task", next: "done" },
    { id: "done", type: "result" },
  ],
};

export function makeApp() {
  return createApp({
    repo: createMemoryWorkflowRepo(),
    logger: createLogger("error"),
    config: loadConfig({}),
  });
}

/** Narrow view of the generated OpenAPI document (hono-openapi output). */
interface OpenApiDoc {
  openapi: string;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, Record<string, unknown>> };
}

describe("socket-free app.fetch() harness", () => {
  test("health and version routes return documented responses", async () => {
    const app = makeApp();
    const health = await app.fetch(new Request("http://localhost/api/v1/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const version = await app.fetch(new Request("http://localhost/api/v1/version"));
    expect(version.status).toBe(200);
    const body = (await version.json()) as Record<string, unknown>;
    expect(body.service).toBe("rostrum-control-api");
    expect(body.interfaceVersion).toBe("v1");
  });

  test("publish and retrieve round-trip exactly with a reproducible digest", async () => {
    const app = makeApp();
    const post = await app.fetch(
      new Request("http://localhost/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validWorkflow),
      }),
    );
    expect(post.status).toBe(201);
    const published = (await post.json()) as {
      id: string;
      version: number;
      digest: string;
      workflow: unknown;
    };
    expect(published.id).toBe("wf-hello");
    expect(published.version).toBe(1);
    expect(published.digest).toBe(workflowDigest(validWorkflow));
    expect(published.workflow).toEqual(validWorkflow);

    const get = await app.fetch(
      new Request("http://localhost/api/v1/workflows/wf-hello/versions/1"),
    );
    expect(get.status).toBe(200);
    const retrieved = (await get.json()) as { workflow: unknown; digest: string };
    expect(retrieved.workflow).toEqual(validWorkflow);
    expect(retrieved.digest).toBe(workflowDigest(retrieved.workflow));
  });

  test("invalid workflow returns stable findings in the error shape", async () => {
    const app = makeApp();
    const post = await app.fetch(
      new Request("http://localhost/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ interfaceVersion: "v1", id: "wf-hello" }),
      }),
    );
    expect(post.status).toBe(400);
    const body = (await post.json()) as {
      code: string;
      findings: Array<{ code: string; path: string }>;
    };
    expect(body.code).toBe("validation_failed");
    expect(body.findings.length).toBeGreaterThan(0);
    expect(body.findings.map((f) => f.code)).toContain("typebox.required");
    expect(body.findings.some((f) => f.path === "/")).toBe(true);
  });

  test("missing published version returns the error shape", async () => {
    const app = makeApp();
    const get = await app.fetch(new Request("http://localhost/api/v1/workflows/nope/versions/9"));
    expect(get.status).toBe(404);
    const body = (await get.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  test("unknown routes return the error shape", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/api/v1/definitely-not-a-route"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  test("disallowed methods return 405 with the error shape", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/v1/workflows", { method: "PUT" }),
    );
    expect(res.status).toBe(405);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("method_not_allowed");
  });

  test("non-numeric version parameters return 404, not a server error", async () => {
    const app = makeApp();
    for (const version of ["abc", "Infinity", "NaN"]) {
      const res = await app.fetch(
        new Request(`http://localhost/api/v1/workflows/wf-hello/versions/${version}`),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("not_found");
    }
  });

  test("workflow JSON with NUL bytes returns 400, not a server error", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...validWorkflow, name: "bad\u0000name" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; findings: Array<{ code: string }> };
    expect(body.code).toBe("validation_failed");
    expect(body.findings.map((f) => f.code)).toContain("typebox.pattern");
  });

  test("event-stream route streams events", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/api/v1/events"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: started");
    expect(text).toContain("event: heartbeat");
    expect(text).toContain("event: complete");
  });

  test("openapi.json is OpenAPI 3.1 with TypeBox details intact", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(200);
    // The generated document's shape is known from hono-openapi; cast once at
    // the fetch boundary, then read through the named interface.
    const doc = (await res.json()) as OpenApiDoc;
    expect(doc.openapi).toBe("3.1.0");
    const post = doc.paths["/api/v1/workflows"] as
      | {
          post?: {
            requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
          };
        }
      | undefined;
    expect(post?.post?.requestBody?.content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/Workflow",
    });
    const schema = doc.components.schemas.Workflow;
    expect(schema).toBeDefined();
    if (!schema) throw new Error("Workflow schema missing from the generated document");
    expect(schema.additionalProperties).toBe(false);
    const props = schema.properties as Record<string, { format?: string }>;
    expect(props.createdAt?.format).toBe("date-time");
    const steps = props.steps as { items?: { anyOf?: unknown[] } };
    expect(steps.items?.anyOf).toHaveLength(2);
    const events = doc.paths["/api/v1/events"] as
      | { get?: { responses?: Record<string, { content?: Record<string, unknown> }> } }
      | undefined;
    expect(events?.get?.responses?.["200"]?.content?.["text/event-stream"]).toBeDefined();
  });

  test("TypeBox schemas round-trip unchanged into the document", async () => {
    const app = makeApp();
    const doc = (await (
      await app.fetch(new Request("http://localhost/openapi.json"))
    ).json()) as OpenApiDoc;
    expect(doc.components.schemas.Workflow).toEqual(JSON.parse(JSON.stringify(WorkflowSchema)));
  });

  test("served openapi.json matches the checked-in dump", async () => {
    const app = makeApp();
    const served = (await (
      await app.fetch(new Request("http://localhost/openapi.json"))
    ).json()) as unknown;
    const dumped = JSON.parse(readFileSync(join(import.meta.dir, "../openapi.json"), "utf8"));
    expect(served).toEqual(dumped);
  });
});
