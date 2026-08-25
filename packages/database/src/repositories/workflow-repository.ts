import type { Finding, PublicationPreparer } from "@rostrum/workflow";
import { type Kysely, sql } from "kysely";
// The `uuid` package is the RFC 9562 implementation of record; minting and
// version checks are its job, not this repository's.
import { validate as isUuid, v7 as mintUuidV7, version as uuidVersion } from "uuid";
import type { Database } from "../schema/database";
import type { RevisionRow } from "../schema/revisions";
import {
    CorruptWorkflowStateError,
    DigestVerificationError,
    DuplicateWorkflowIdError,
    InvalidWorkflowInputError,
} from "./workflow-repository.errors";
import type {
    CreateDraftInput,
    CreatedDraft,
    PublishedVersion,
    PublishInput,
    PublishResult,
    RewindResult,
    SaveRevisionInput,
    SaveRevisionResult,
    StoredRevision,
} from "./workflow-repository.types";

/**
 * Postgres persistence for drafts, revisions, and published versions
 * (E1-07). Implements the lifecycle contract of E1-S3:
 *
 * - saves are one transaction — insert the revision, then conditionally
 *   update `workflows.current_revision`; zero rows updated means a stale
 *   `baseRevision`, reported as a conflict with no partial write;
 * - publishes take a row lock on the workflow so per-workflow version
 *   numbers stay gapless, and the unique `(workflow_id, revision)` index
 *   makes repeat publishes return the existing single version;
 * - rewind deletes revisions newer than the target but refuses targets
 *   older than the newest published source, keeping every published
 *   version's source revision retrievable.
 *
 * Published rows have no update or delete path in this class; published
 * versions are immutable by construction (E1-S3).
 */
export class WorkflowRepository {
    private readonly db: Kysely<Database>;

    private readonly preparer: PublicationPreparer;

    /**
     * Creates a repository bound to one Kysely instance. The publication
     * preparer canonicalizes stored text again at retrieval so tampered or
     * non-canonical rows fail verification; callers supply it because
     * publication preparation belongs to @rostrum/workflow.
     */
    constructor(db: Kysely<Database>, preparer: PublicationPreparer) {
        this.db = db;
        this.preparer = preparer;
    }

    /**
     * Creates the draft: inserts the workflow row and stores the submitted
     * document as its first revision, so every draft has at least one
     * revision (E1-S3 identity rule; creation is the first save).
     */
    async createDraft(input: CreateDraftInput): Promise<CreatedDraft> {
        this.assertWorkflowId(input.workflowId);
        return this.db.transaction().execute(async (tx) => {
            const revisionId = mintUuidV7();
            try {
                await tx
                    .insertInto("workflows")
                    .values({ id: input.workflowId, createdAt: sql`now()`, updatedAt: sql`now()` })
                    .execute();
            } catch (error) {
                // A duplicate id surfaces as a driver-level unique violation;
                // translate it once here so consumers never parse driver errors.
                if (isUniqueViolation(error)) {
                    throw new DuplicateWorkflowIdError(input.workflowId);
                }
                throw error;
            }
            await tx
                .insertInto("revisions")
                .values(this.revisionValues(input.workflowId, revisionId, input))
                .execute();
            await tx
                .updateTable("workflows")
                .set({ currentRevision: revisionId })
                .where("id", "=", input.workflowId)
                .execute();
            return {
                workflowId: input.workflowId,
                revision: await this.requireRevision(tx, input.workflowId, revisionId),
            };
        });
    }

    /**
     * Saves one revision under the optimistic `baseRevision` check: the
     * transaction inserts the new revision and conditionally updates the
     * draft's current-revision pointer. A stale or mismatched base leaves
     * no partial write and returns the current revision with its findings.
     */
    async saveRevision(workflowId: string, input: SaveRevisionInput): Promise<SaveRevisionResult> {
        this.assertWorkflowId(workflowId);
        return this.db.transaction().execute(async (tx) => {
            // The row lock makes the baseRevision check and the pointer flip
            // one atomic step against the latest committed state; a stale
            // save is rejected before any revision row exists, so a conflict
            // never leaves a partial write behind (E1-S3 save contract).
            const draft = await tx
                .selectFrom("workflows")
                .select("currentRevision")
                .where("id", "=", workflowId)
                .forUpdate()
                .executeTakeFirst();
            if (!draft) {
                return { outcome: "not-found" } as const;
            }
            if (draft.currentRevision !== input.baseRevision) {
                if (!draft.currentRevision) {
                    throw new CorruptWorkflowStateError(
                        `Workflow ${workflowId} has a null current revision while accepting saves`,
                    );
                }
                return {
                    outcome: "conflict",
                    currentRevision: await this.requireRevision(
                        tx,
                        workflowId,
                        draft.currentRevision,
                    ),
                } satisfies SaveRevisionResult;
            }
            const revisionId = mintUuidV7();
            await tx
                .insertInto("revisions")
                .values(this.revisionValues(workflowId, revisionId, input))
                .execute();
            await tx
                .updateTable("workflows")
                .set({ currentRevision: revisionId })
                .where("id", "=", workflowId)
                .execute();
            return {
                outcome: "saved",
                revision: await this.requireRevision(tx, workflowId, revisionId),
            };
        });
    }

    /** Returns the draft's current revision, or null when it has none. */
    async getCurrentRevision(workflowId: string): Promise<StoredRevision | null> {
        this.assertWorkflowId(workflowId);
        const draft = await this.db
            .selectFrom("workflows")
            .select("currentRevision")
            .where("id", "=", workflowId)
            .executeTakeFirst();
        if (!draft?.currentRevision) {
            return null;
        }
        const row = await this.getRevisionRow(this.db, workflowId, draft.currentRevision);
        return row ? this.toStoredRevision(row) : null;
    }

    /** Returns one stored revision, byte-exact, or null when it does not exist. */
    async getRevision(workflowId: string, revisionId: string): Promise<StoredRevision | null> {
        this.assertWorkflowId(workflowId);
        const row = await this.getRevisionRow(this.db, workflowId, revisionId);
        return row ? this.toStoredRevision(row) : null;
    }

    /**
     * Rewinds the draft to an earlier revision: newer revisions are deleted
     * and the target becomes current. Refuses targets older than the newest
     * published source so every published version keeps its source revision.
     * Rewinding to the current revision with nothing newer is a no-op.
     */
    async rewind(workflowId: string, targetRevisionId: string): Promise<RewindResult> {
        this.assertWorkflowId(workflowId);
        return this.db.transaction().execute(async (tx) => {
            const draft = await tx
                .selectFrom("workflows")
                .select(["currentRevision"])
                .where("id", "=", workflowId)
                .forUpdate()
                .executeTakeFirst();
            if (!draft) {
                return { outcome: "not-found" } as const;
            }
            const target = await this.getRevisionRow(tx, workflowId, targetRevisionId);
            if (!target) {
                return { outcome: "target-not-found" } as const;
            }
            // The newest published source, compared to the target entirely in
            // SQL: Postgres keeps microsecond precision that JavaScript Dates
            // truncate, so the floor check and the deletion below must use
            // the same tuple comparison or a published source could be deleted.
            const newerPublishedSource = await tx
                .selectFrom("revisions")
                .innerJoin("publishedVersions", "publishedVersions.revisionId", "revisions.id")
                .where("revisions.workflowId", "=", workflowId)
                .where(
                    sql<boolean>`(${sql.ref("revisions.created_at")}, ${sql.ref("revisions.id")}) > (
                        select r2.created_at, r2.id from revisions r2 where r2.id = ${targetRevisionId}
                    )`,
                )
                .select("revisions.id")
                .orderBy("revisions.createdAt", "desc")
                .orderBy("revisions.id", "desc")
                .limit(1)
                .executeTakeFirst();
            if (newerPublishedSource?.id) {
                return {
                    outcome: "refused",
                    publishedSourceRevisionId: newerPublishedSource.id,
                } satisfies RewindResult;
            }
            const newer = await tx
                .selectFrom("revisions")
                .where("workflowId", "=", workflowId)
                .where(sql<boolean>`(${sql.ref("created_at")}, ${sql.ref("id")}) > (
                    select r2.created_at, r2.id from revisions r2 where r2.id = ${targetRevisionId}
                )`)
                .select("id")
                .execute();
            const deletedRevisionIds = newer
                .map((row) => row.id)
                .filter((id): id is string => id !== undefined);
            if (deletedRevisionIds.length > 0) {
                await tx.deleteFrom("revisions").where("id", "in", deletedRevisionIds).execute();
            }
            if (deletedRevisionIds.length === 0 && draft.currentRevision === target.id) {
                return { outcome: "no-op" } satisfies RewindResult;
            }
            await tx
                .updateTable("workflows")
                .set({ currentRevision: target.id, updatedAt: new Date() })
                .where("id", "=", workflowId)
                .execute();
            return { outcome: "rewound", deletedRevisionIds } satisfies RewindResult;
        });
    }

    /**
     * Stores one immutable published version under the next per-workflow
     * integer version number. The row lock on the workflow serializes
     * concurrent publishes; publishing an already-published revision
     * returns that existing version instead of creating another.
     *
     * Validation and canonicalization happen before this call: the input
     * carries the preparation `PublicationPreparer` produced for a valid
     * revision.
     */
    async publish(input: PublishInput): Promise<PublishResult> {
        this.assertWorkflowId(input.workflowId);
        return this.db.transaction().execute(async (tx) => {
            const locked = await tx
                .selectFrom("workflows")
                .select("id")
                .where("id", "=", input.workflowId)
                .forUpdate()
                .executeTakeFirst();
            if (!locked) {
                return { outcome: "not-found" } as const;
            }
            const revision = await this.getRevisionRow(tx, input.workflowId, input.revisionId);
            if (!revision) {
                return { outcome: "revision-not-found" } as const;
            }
            const existing = await tx
                .selectFrom("publishedVersions")
                .select("versionNumber")
                .where("workflowId", "=", input.workflowId)
                .where("revisionId", "=", input.revisionId)
                .executeTakeFirst();
            if (existing) {
                return {
                    outcome: "already-published",
                    versionNumber: existing.versionNumber,
                } satisfies PublishResult;
            }
            const max = await tx
                .selectFrom("publishedVersions")
                .select((eb) => eb.fn.max("versionNumber").as("maxVersion"))
                .where("workflowId", "=", input.workflowId)
                .executeTakeFirstOrThrow();
            const versionNumber = Number(max.maxVersion ?? 0) + 1;
            await tx
                .insertInto("publishedVersions")
                .values({
                    workflowId: input.workflowId,
                    versionNumber,
                    revisionId: input.revisionId,
                    interfaceVersion: input.interfaceVersion,
                    canonicalText: input.canonicalText,
                    digest: input.digest,
                    createdAt: sql`now()`,
                })
                .execute();
            await tx
                .updateTable("workflows")
                .set({ updatedAt: new Date() })
                .where("id", "=", input.workflowId)
                .execute();
            return { outcome: "published", versionNumber } satisfies PublishResult;
        });
    }

    /**
     * Returns one published version after verifying it: the digest is
     * recomputed from the stored canonical text and compared to the stored
     * digest, and the text must already be in canonical form. Returns null
     * when the workflow has no such version.
     */
    async getPublishedVersion(
        workflowId: string,
        versionNumber: number,
    ): Promise<PublishedVersion | null> {
        this.assertWorkflowId(workflowId);
        const row = await this.db
            .selectFrom("publishedVersions")
            .selectAll()
            .where("workflowId", "=", workflowId)
            .where("versionNumber", "=", versionNumber)
            .executeTakeFirst();
        if (!row) {
            return null;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(row.canonicalText);
        } catch {
            throw new DigestVerificationError(
                workflowId,
                versionNumber,
                "stored text is not valid JSON",
            );
        }
        try {
            const prepared = await this.preparer.prepare(parsed as object);
            if (prepared.digest !== row.digest) {
                throw new DigestVerificationError(
                    workflowId,
                    versionNumber,
                    `recomputed digest ${prepared.digest} does not equal stored digest ${row.digest}`,
                );
            }
            if (prepared.canonicalText !== row.canonicalText) {
                throw new DigestVerificationError(
                    workflowId,
                    versionNumber,
                    "stored text is not in RFC 8785 canonical form",
                );
            }
        } catch (error) {
            if (error instanceof DigestVerificationError) {
                throw error;
            }
            throw new DigestVerificationError(
                workflowId,
                versionNumber,
                `stored text cannot be canonicalized: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return {
            versionNumber: row.versionNumber,
            revisionId: row.revisionId,
            interfaceVersion: row.interfaceVersion,
            canonicalText: row.canonicalText,
            digest: row.digest,
            createdAt: row.createdAt,
        };
    }

    /**
     * Builds the insert payload for one revision and enforces the write
     * guards both entry points share: byte content must be non-empty text
     * and findings must be an array.
     */
    private revisionValues(
        workflowId: string,
        revisionId: string,
        input: { content: string; findings: readonly Finding[]; name?: string | null },
    ) {
        if (typeof input.content !== "string" || input.content.length === 0) {
            throw new InvalidWorkflowInputError("Workflow content must be a non-empty string");
        }
        if (!Array.isArray(input.findings)) {
            throw new InvalidWorkflowInputError("Validation findings must be an array");
        }
        return {
            id: revisionId,
            workflowId,
            content: input.content,
            findings: JSON.stringify(input.findings),
            createdAt: sql<Date>`now()`,
        };
    }

    /** Returns the stored revision row for one draft, or undefined when absent. */
    private async getRevisionRow(
        db: Kysely<Database>,
        workflowId: string,
        revisionId: string,
    ): Promise<RevisionRow | undefined> {
        return db
            .selectFrom("revisions")
            .selectAll()
            .where("workflowId", "=", workflowId)
            .where("id", "=", revisionId)
            .executeTakeFirst();
    }

    /**
     * Returns one revision or fails: a row missing mid-transaction is
     * corrupt state, not a lookup miss.
     */
    private async requireRevision(
        db: Kysely<Database>,
        workflowId: string,
        revisionId: string,
    ): Promise<StoredRevision> {
        const row = await this.getRevisionRow(db, workflowId, revisionId);
        if (!row) {
            throw new CorruptWorkflowStateError(
                `Revision ${revisionId} of workflow ${workflowId} is missing`,
            );
        }
        return this.toStoredRevision(row);
    }

    /** Maps one row into the application shape, parsing and checking its findings snapshot. */
    private toStoredRevision(row: RevisionRow): StoredRevision {
        let parsed: unknown;
        try {
            parsed = JSON.parse(row.findings);
        } catch {
            throw new CorruptWorkflowStateError(
                `Findings snapshot of revision ${row.id} is not valid JSON`,
            );
        }
        if (!Array.isArray(parsed)) {
            throw new CorruptWorkflowStateError(
                `Findings snapshot of revision ${row.id} is not an array`,
            );
        }
        return {
            revisionId: row.id,
            workflowId: row.workflowId,
            name: row.name,
            content: row.content,
            findings: parsed as Finding[],
            createdAt: row.createdAt,
        };
    }

    /** Rejects ids that are not UUID v7 before any transaction opens (E1-S3 identity rule). */
    private assertWorkflowId(workflowId: string): void {
        // `validate` accepts every RFC 9562 shape; the version nibble must
        // be 7 for a workflow id (E1-S3 identity rule).
        if (!isUuid(workflowId) || uuidVersion(workflowId) !== 7) {
            throw new InvalidWorkflowInputError(`'${workflowId}' is not a UUID v7 workflow id`);
        }
    }
}

/** Postgres SQLSTATE for a unique-constraint violation (duplicate workflow ids). */
const UNIQUE_VIOLATION_CODE = "23505";

/** Returns true when `error` is a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
    );
}
