/**
 * Negative typecheck fixtures for E1-S0 row 12: wrong paths, parameters, and
 * bodies must fail typechecking. Each `@ts-expect-error` is the assertion —
 * if any usage below becomes valid, tsc reports an unused directive and the
 * typecheck fails. This file is never executed.
 */
import { ControlApiClient } from "./client";
import type { paths } from "./generated";

const client = new ControlApiClient("http://localhost:3000");

export const wrongBodyMissingRequired = client.publishWorkflow(
  // @ts-expect-error — missing required properties (name, createdAt, start, steps)
  { interfaceVersion: "v1", id: "wf-hello" },
);

export const wrongBodyWrongType = client.publishWorkflow({
  interfaceVersion: "v1",
  id: "wf-hello",
  name: "Hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  // @ts-expect-error — start must be a string
  start: 42,
  steps: [],
});

export const wrongBodyUnknownProperty = client.publishWorkflow({
  interfaceVersion: "v1",
  id: "wf-hello",
  name: "Hello",
  createdAt: "2026-08-10T12:00:00.000Z",
  start: "say",
  steps: [],
  // @ts-expect-error — unknown property (additionalProperties: false)
  bogus: true,
});

export const wrongPathParameterType = client.getPublishedWorkflow(
  // @ts-expect-error — id must be a string
  123,
  "1",
);

export const wrongVersionParameterType = client.getPublishedWorkflow(
  "wf-hello",
  // @ts-expect-error — version must be a number
  "1",
);

// @ts-expect-error — no such path in the served document
export const wrongPathInGeneratedTypes: paths["/api/v1/definitely-not-a-route"] =
  undefined as never;
