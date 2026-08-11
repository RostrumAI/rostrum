import { describe, expect, test } from "bun:test";
import Schema from "typebox/schema";
import { HealthSchema, WorkflowPublishedSchema } from "../src/schemas";
import { makeApp, validWorkflow } from "./app.test";

/**
 * Row 11: response contract checking. Handler responses are asserted with
 * `Schema.Compile`; seeded violations must fail the same checks, and a clean
 * service passes them. Schemathesis runs against the live service separately
 * (see the E1-S0 verification runbook).
 */
describe("response contract checking", () => {
  test("a clean handler response passes the compiled contract", async () => {
    const app = makeApp();

    const health = await app.fetch(new Request("http://localhost/api/v1/health"));
    const healthBody = await health.json();
    const healthCheck = Schema.Compile(HealthSchema);
    expect(healthCheck.Check(healthBody)).toBe(true);

    const post = await app.fetch(
      new Request("http://localhost/api/v1/workflows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validWorkflow),
      }),
    );
    const published = await post.json();
    const publishedCheck = Schema.Compile(WorkflowPublishedSchema);
    expect(publishedCheck.Check(published)).toBe(true);
    expect(JSON.parse(JSON.stringify(publishedCheck.Parse(published)))).toEqual(published);
  });

  test("a seeded violation fails the contract check", async () => {
    // Missing required field.
    const missingDigest = {
      id: "wf-hello",
      version: 1,
      createdAt: "2026-08-10T12:00:00.000Z",
      workflow: validWorkflow,
    };
    expect(Schema.Compile(WorkflowPublishedSchema).Check(missingDigest)).toBe(false);

    // Wrong type.
    const wrongVersionType = {
      id: "wf-hello",
      version: "1",
      digest: "abc",
      createdAt: "2026-08-10T12:00:00.000Z",
      workflow: validWorkflow,
    };
    expect(Schema.Compile(WorkflowPublishedSchema).Check(wrongVersionType)).toBe(false);
  });

  test("an undocumented field fails the contract check", async () => {
    const extraField = { status: "ok", seeded: "violation" };
    expect(Schema.Compile(HealthSchema).Check(extraField)).toBe(false);
  });
});
