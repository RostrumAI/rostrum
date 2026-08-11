import { findingsFromErrors, validateWorkflow } from "@rostrum/workflow-lib";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { WorkflowRepo } from "../db/workflows-repo";

export function workflowsRoutes(repo: WorkflowRepo): Hono {
  const app = new Hono();

  app.post(
    "/workflows",
    describeRoute({
      tags: ["workflows"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/Workflow" } } },
      },
      responses: {
        201: {
          description: "Workflow validated and published",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/WorkflowPublished" } },
          },
        },
        400: {
          description: "Workflow does not conform to interface v1",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const result = validateWorkflow(body);
      if (!result.ok) {
        return c.json(
          {
            code: "validation_failed",
            message: "Workflow does not conform to interface v1",
            findings: findingsFromErrors(result.errors),
          },
          400,
        );
      }
      const published = await repo.publish(result.value);
      return c.json(
        {
          id: published.id,
          version: published.version,
          digest: published.digest,
          createdAt: published.createdAt,
          workflow: published.content,
        },
        201,
      );
    },
  );

  app.get(
    "/workflows/:id/versions/:version",
    describeRoute({
      tags: ["workflows"],
      responses: {
        200: {
          description: "The published workflow version",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/WorkflowPublished" } },
          },
        },
        404: {
          description: "No such published version",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } },
          },
        },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const version = Number(c.req.param("version"));
      if (!Number.isInteger(version) || version < 1) {
        return c.json(
          {
            code: "not_found",
            message: `No published workflow "${id}" version ${c.req.param("version")}`,
            findings: [],
          },
          404,
        );
      }
      const published = await repo.getPublished(id, version);
      if (!published) {
        return c.json(
          {
            code: "not_found",
            message: `No published workflow "${id}" version ${version}`,
            findings: [],
          },
          404,
        );
      }
      return c.json({
        id: published.id,
        version: published.version,
        digest: published.digest,
        createdAt: published.createdAt,
        workflow: published.content,
      });
    },
  );

  return app;
}
