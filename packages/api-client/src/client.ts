import type { components } from "./generated";

type Workflow = components["schemas"]["Workflow"];
type WorkflowPublished = components["schemas"]["WorkflowPublished"];
type Health = components["schemas"]["Health"];

/**
 * Typed client generated from the served OpenAPI document (E1-S0 row 12).
 * Every method signature is derived from `components` / `paths` types, so
 * wrong paths, parameters, or bodies fail typechecking.
 */
export class ControlApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getHealth(): Promise<Health> {
    return this.request("/api/v1/health");
  }

  async publishWorkflow(workflow: Workflow): Promise<WorkflowPublished> {
    return this.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workflow),
    });
  }

  async getPublishedWorkflow(id: string, version: number): Promise<WorkflowPublished> {
    const path = `/api/v1/workflows/${encodeURIComponent(id)}/versions/${version}`;
    return this.request(path);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${path}`);
    }
    return (await response.json()) as T;
  }
}
