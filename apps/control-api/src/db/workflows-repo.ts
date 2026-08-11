import type { Workflow } from "@rostrum/workflow-lib";
import { workflowDigest } from "@rostrum/workflow-lib";
import type { Kysely } from "kysely";
import { createKysely, type Sql } from "./client";
import type { Database } from "./types";

export interface PublishedWorkflow {
  id: string;
  version: number;
  content: Workflow;
  digest: string;
  createdAt: string;
}

/**
 * The persistence boundary the Control API and the future daemon share.
 * POC-thin: draft/revision lifecycle, revision checks, and immutability
 * rules arrive with E1-S3/E1-07.
 */
export interface WorkflowRepo {
  publish(content: Workflow): Promise<PublishedWorkflow>;
  getPublished(id: string, version: number): Promise<PublishedWorkflow | null>;
}

interface PublishedRow {
  id: string;
  version: number;
  content: unknown;
  digest: string;
  created_at: Date;
}

function toPublished(row: PublishedRow): PublishedWorkflow {
  return {
    id: row.id,
    version: row.version,
    content: row.content as Workflow,
    digest: row.digest,
    createdAt: row.created_at.toISOString(),
  };
}

async function nextVersion(kysely: Kysely<Database>, id: string): Promise<number> {
  const row = await kysely
    .selectFrom("published_versions")
    .select(kysely.fn.max("version").as("max_version"))
    .where("id", "=", id)
    .executeTakeFirst();
  return ((row?.max_version as number | null) ?? 0) + 1;
}

export function createPostgresWorkflowRepo(db: Sql): WorkflowRepo {
  const kysely = createKysely(db);
  return {
    async publish(content) {
      const version = await nextVersion(kysely, content.id);
      const digest = workflowDigest(content);
      await kysely
        .insertInto("published_versions")
        .values({ id: content.id, version, content, digest })
        .execute();
      const row = await kysely
        .selectFrom("published_versions")
        .selectAll()
        .where("id", "=", content.id)
        .where("version", "=", version)
        .executeTakeFirstOrThrow();
      return toPublished(row);
    },
    async getPublished(id, version) {
      const row = await kysely
        .selectFrom("published_versions")
        .selectAll()
        .where("id", "=", id)
        .where("version", "=", version)
        .executeTakeFirst();
      return row ? toPublished(row) : null;
    },
  };
}

/** In-memory repo for socket-free tests and the OpenAPI dump script. */
export function createMemoryWorkflowRepo(): WorkflowRepo {
  const store = new Map<string, PublishedWorkflow>();
  return {
    async publish(content) {
      const versions = [...store.values()]
        .filter((p) => p.id === content.id)
        .map((p) => p.version)
        .sort((a, b) => b - a);
      const version = (versions[0] ?? 0) + 1;
      const published: PublishedWorkflow = {
        id: content.id,
        version,
        content,
        digest: workflowDigest(content),
        createdAt: new Date().toISOString(),
      };
      store.set(`${content.id}:${version}`, published);
      return published;
    },
    async getPublished(id, version) {
      return store.get(`${id}:${version}`) ?? null;
    },
  };
}
