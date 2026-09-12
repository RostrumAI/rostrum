/** @fileoverview Workflow repository integration tests. */

import { afterAll, describe, expect, test } from "bun:test";
import {
    createWorkflowValidator,
    type Finding,
    PublicationPreparer,
    V1_RULE_SET,
} from "@rostrum/workflow";
import boundedLoopJson from "@rostrum/workflow/fixtures/valid/bounded-loop.json";
import conditionalGroupsJson from "@rostrum/workflow/fixtures/valid/conditional-groups.json";
import { type Kysely, sql } from "kysely";
import { v7 as mintUuidV7, version as uuidVersion } from "uuid";
import { createDatabase } from "../client";
import { migrateToLatest } from "../migrator";
import type { Database } from "../schema/database";
import { startTestPostgres } from "../testing/postgres";
import { WorkflowRepository } from "./workflow-repository";
import { DigestVerificationError, InvalidWorkflowInputError } from "./workflow-repository.errors";
import type { CreatedDraft, PublishInput, StoredRevision } from "./workflow-repository.types";

// CI supplies DATABASE_URL; everywhere else the suite starts an embedded
// Postgres cluster so the tests run wherever the repository clones.
const testPostgres = await startTestPostgres();
afterAll(() => testPostgres.stop());

const FINDINGS_DRAFT: Finding[] = [
    {
        code: "workflow.shape.required-field",
        message: "steps is required",
        blocking: true,
        path: "",
    },
];

const validator = createWorkflowValidator();
const preparer = new PublicationPreparer(V1_RULE_SET);

/**
 * Fresh copies of the shared fixture documents. The optional name rewrites
 * the display-name metadata member, so metadata-only edit scenarios store
 * two documents whose definitional bytes stay identical.
 */
function boundedLoopDocument(name?: string): Record<string, unknown> {
    return fixtureDocument(boundedLoopJson, name);
}

/** The conditional-grouping fixture under the same fresh-copy contract. */
function conditionalGroupsDocument(name?: string): Record<string, unknown> {
    return fixtureDocument(conditionalGroupsJson, name);
}

/** Returns a deep copy of a fixture document with its display name replaced. */
function fixtureDocument(base: Record<string, unknown>, name?: string): Record<string, unknown> {
    const document = structuredClone(base);
    if (name !== undefined) {
        document.name = name;
    }
    return document;
}

/** Raw submitted bytes with CRLF line endings and an escaped NUL member. */
const RAW_NUL_CONTENT = `{
  "workflowFormatVersion": "v1",\r
  "id": "0192b0a0-7e1d-7000-8000-000000000009",
  "name": "nul\\u0000probe",
  "firstNode": "0192b0a0-7e1d-7000-8000-000000000002",
  "steps": []
}
`;

async function preparePublishInput(
    workflowId: string,
    revisionId: string,
    document: Record<string, unknown>,
): Promise<PublishInput> {
    const prepared = await preparer.prepare(document);
    return {
        workflowId,
        revisionId,
        canonicalText: prepared.canonicalText,
        digest: prepared.digest,
        workflowFormatVersion: document.workflowFormatVersion as string,
    };
}

async function countRevisions(database: Storage, workflowId: string): Promise<number> {
    const rows = await database.db
        .selectFrom("revisions")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("workflowId", "=", workflowId)
        .executeTakeFirstOrThrow();
    return Number(rows.count);
}

async function revisionIds(database: Storage, workflowId: string): Promise<string[]> {
    const rows = await database.db
        .selectFrom("revisions")
        .select("id")
        .where("workflowId", "=", workflowId)
        .orderBy("createdAt", "asc")
        .execute();
    return rows.map((row) => row.id).filter((id): id is string => id !== undefined);
}

/** Asserts one save succeeded and returns its revision (test seam). */
function savedRevision(result: { outcome: string; revision?: StoredRevision }): StoredRevision {
    if (result.outcome !== "saved" || !result.revision) {
        throw new Error(`Expected a saved revision, got outcome '${result.outcome}'`);
    }
    return result.revision;
}

/** One open database under test: the typed connection plus the repository. */
interface Storage {
    readonly db: Kysely<Database>;
    readonly workflows: WorkflowRepository;
}

/** Opens one migrated database with empty tables and closes it afterwards. */
async function withDatabase<T>(run: (database: Storage) => Promise<T>): Promise<T> {
    const handle = createDatabase(testPostgres.options);
    const db = handle.db;
    try {
        await migrateToLatest(db);
        await sql`TRUNCATE publications, revisions, workflows`.execute(db);
        return await run({ db, workflows: new WorkflowRepository(db, preparer) });
    } finally {
        await handle.close({ timeoutMs: 1_000 });
    }
}

describe("drafts and revisions", () => {
    test("createDraft stores the first revision byte-exactly", async () => {
        await withDatabase(async (database) => {
            const content = JSON.stringify(boundedLoopDocument(), null, 4);
            const created = await database.workflows.createDraft({
                content,
                findings: [],
            });
            expect(uuidVersion(created.workflowId)).toBe(7);
            expect(created.revision.content).toBe(content);
            expect(created.revision.type).toBe("save");

            const current = await database.workflows.getCurrentRevision(created.workflowId);
            expect(current?.revisionId).toBe(created.revision.revisionId);
            expect(current?.content).toBe(content);
        });
    });

    test("round-trips CRLF text, Unicode, and escaped NUL bytes", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: RAW_NUL_CONTENT,
                findings: FINDINGS_DRAFT,
            });
            const stored = await database.workflows.getRevision(
                created.workflowId,
                created.revision.revisionId,
            );
            expect(stored?.content).toBe(RAW_NUL_CONTENT);
            expect(stored?.findings).toEqual(FINDINGS_DRAFT);
        });
    });

    test("rejects stale baseRevision values with the current revision", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: '{"v":1}',
                findings: FINDINGS_DRAFT,
            });
            const workflowId = created.workflowId;

            // A null base after creation means the client never saw a revision.
            const staleNull = await database.workflows.saveRevision(workflowId, {
                baseRevision: null,
                content: '{"v":2}',
                findings: [],
            });
            expect(staleNull.outcome).toBe("conflict");
            if (staleNull.outcome === "conflict") {
                expect(staleNull.currentRevision.revisionId).toBe(created.revision.revisionId);
            }

            const secondRevision = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: '{"v":2}',
                    findings: [],
                }),
            );

            // Replaying the first save's base must not overwrite newer work.
            const replayed = await database.workflows.saveRevision(workflowId, {
                baseRevision: created.revision.revisionId,
                content: '{"v":3}',
                findings: FINDINGS_DRAFT,
            });
            expect(replayed).toEqual({
                outcome: "conflict",
                currentRevision: {
                    revisionId: secondRevision.revisionId,
                    workflowId,
                    name: null,
                    content: '{"v":2}',
                    type: "save",
                    findings: [],
                    createdAt: secondRevision.createdAt,
                },
            });

            expect(await countRevisions(database, workflowId)).toBe(2);
            expect(await database.workflows.getCurrentRevision(workflowId)).toMatchObject({
                content: '{"v":2}',
            });
        });
    });

    test("reports unknown workflows on save", async () => {
        await withDatabase(async (database) => {
            const result = await database.workflows.saveRevision(mintUuidV7(), {
                baseRevision: null,
                content: "{}",
                findings: [],
            });
            expect(result.outcome).toBe("not-found");
        });
    });

    test("survives a full connection restart byte-for-byte", async () => {
        let created: CreatedDraft;
        {
            const handle = createDatabase(testPostgres.options);
            const first = handle.db;
            try {
                await migrateToLatest(first);
                await sql`TRUNCATE publications, revisions, workflows`.execute(first);
                const firstWorkflows = new WorkflowRepository(first, preparer);
                const document = conditionalGroupsDocument("Restart durable");
                created = await firstWorkflows.createDraft({
                    content: JSON.stringify(document),
                    findings: [],
                });
                const input = await preparePublishInput(
                    created.workflowId,
                    created.revision.revisionId,
                    document,
                );
                await firstWorkflows.publish(input);
            } finally {
                await handle.close({ timeoutMs: 1_000 });
            }
        }
        {
            const handle = createDatabase(testPostgres.options);
            const reopened = handle.db;
            try {
                const reopenedWorkflows = new WorkflowRepository(reopened, preparer);
                const draft = await reopenedWorkflows.getRevision(
                    created.workflowId,
                    created.revision.revisionId,
                );
                expect(draft?.content).toBe(created.revision.content);
                const publication = await reopenedWorkflows.getPublication(created.workflowId, 1);
                expect(publication?.digest).toBeDefined();
            } finally {
                await handle.close({ timeoutMs: 1_000 });
            }
        }
    });
});

describe("rewind", () => {
    test("appends a copy of the target and repoints the draft", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: '{"v":1}',
                findings: [],
            });
            const workflowId = created.workflowId;
            const second = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: '{"v":2}',
                    findings: [],
                }),
            );
            const third = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: second.revisionId,
                    content: '{"v":3}',
                    findings: [],
                }),
            );

            const rewound = await database.workflows.rewind(
                workflowId,
                created.revision.revisionId,
            );
            expect(rewound.outcome).toBe("rewound");
            if (rewound.outcome !== "rewound") {
                throw new Error("expected a rewound outcome");
            }
            // The appended copy carries the target's bytes; nothing was deleted.
            expect(rewound.revision.revisionId).not.toBe(created.revision.revisionId);
            expect(rewound.revision.content).toBe('{"v":1}');
            expect(rewound.revision.type).toBe("rewind");
            expect(await countRevisions(database, workflowId)).toBe(4);
            expect(await revisionIds(database, workflowId)).toEqual([
                created.revision.revisionId,
                second.revisionId,
                third.revisionId,
                rewound.revision.revisionId,
            ]);

            const current = await database.workflows.getCurrentRevision(workflowId);
            expect(current?.revisionId).toBe(rewound.revision.revisionId);
            expect(current?.content).toBe('{"v":1}');

            // Saves continue from the appended revision.
            const resumed = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: rewound.revision.revisionId,
                    content: '{"v":4}',
                    findings: [],
                }),
            );
            expect(resumed.content).toBe('{"v":4}');
        });
    });

    test("treats rewinding to the current revision as a no-op", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: '{"v":1}',
                findings: [],
            });
            expect(
                await database.workflows.rewind(created.workflowId, created.revision.revisionId),
            ).toEqual({ outcome: "no-op" });
        });
    });

    test("keeps published sources intact when rewinding past them", async () => {
        await withDatabase(async (database) => {
            const document = boundedLoopDocument();
            const created = await database.workflows.createDraft({
                content: JSON.stringify(document),
                findings: [],
            });
            const workflowId = created.workflowId;
            const renamedContent = JSON.stringify(boundedLoopDocument("Renamed"));
            const second = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: renamedContent,
                    findings: [],
                }),
            );

            // Publish from the second revision, then rewind past its source.
            const input = await preparePublishInput(
                workflowId,
                second.revisionId,
                boundedLoopDocument("Renamed"),
            );
            await database.workflows.publish(input);

            const rewound = await database.workflows.rewind(
                workflowId,
                created.revision.revisionId,
            );
            expect(rewound.outcome).toBe("rewound");

            // The publication still verifies against its stored bytes
            // and its source revision remains retrievable.
            const publication = await database.workflows.getPublication(workflowId, 1);
            expect(publication?.digest).toBe(input.digest);
            expect(publication?.revisionId).toBe(second.revisionId);
            const source = await database.workflows.getRevision(workflowId, second.revisionId);
            expect(source?.content).toBe(renamedContent);
        });
    });

    test("appends a fresh copy per rewind", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: '{"v":1}',
                findings: [],
            });
            const workflowId = created.workflowId;
            savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: '{"v":2}',
                    findings: [],
                }),
            );

            const first = await database.workflows.rewind(workflowId, created.revision.revisionId);
            const repeated = await database.workflows.rewind(
                workflowId,
                created.revision.revisionId,
            );
            if (first.outcome !== "rewound" || repeated.outcome !== "rewound") {
                throw new Error("expected both rewinds to succeed");
            }
            expect(first.revision.revisionId).not.toBe(repeated.revision.revisionId);
            expect(repeated.revision.content).toBe('{"v":1}');
            expect(await countRevisions(database, workflowId)).toBe(4);
            const current = await database.workflows.getCurrentRevision(workflowId);
            expect(current?.revisionId).toBe(repeated.revision.revisionId);
        });
    });

    test("reports missing workflows and targets", async () => {
        await withDatabase(async (database) => {
            expect(await database.workflows.rewind(mintUuidV7(), mintUuidV7())).toEqual({
                outcome: "not-found",
            });
            const created = await database.workflows.createDraft({
                content: "{}",
                findings: [],
            });
            expect(await database.workflows.rewind(created.workflowId, mintUuidV7())).toEqual({
                outcome: "target-not-found",
            });
        });
    });
});

describe("input guards", () => {
    test("rejects malformed workflow ids on every entry point", async () => {
        await withDatabase(async (database) => {
            const malformed = "not-a-uuid";
            await expect(
                database.workflows.saveRevision(malformed, {
                    baseRevision: null,
                    content: "{}",
                    findings: [],
                }),
            ).rejects.toThrow(InvalidWorkflowInputError);
            await expect(database.workflows.getCurrentRevision(malformed)).rejects.toThrow(
                InvalidWorkflowInputError,
            );
            await expect(database.workflows.getRevision(malformed, mintUuidV7())).rejects.toThrow(
                InvalidWorkflowInputError,
            );
            await expect(database.workflows.rewind(malformed, mintUuidV7())).rejects.toThrow(
                InvalidWorkflowInputError,
            );
            await expect(
                database.workflows.publish({
                    workflowId: malformed,
                    revisionId: mintUuidV7(),
                    canonicalText: "{}",
                    digest: "a".repeat(64),
                    workflowFormatVersion: "v1",
                }),
            ).rejects.toThrow(InvalidWorkflowInputError);
            await expect(database.workflows.getPublication(malformed, 1)).rejects.toThrow(
                InvalidWorkflowInputError,
            );
        });
    });

    test("rejects empty content and malformed findings", async () => {
        await withDatabase(async (database) => {
            await expect(
                database.workflows.createDraft({
                    content: "",
                    findings: [],
                }),
            ).rejects.toThrow(InvalidWorkflowInputError);
            await expect(
                database.workflows.createDraft({
                    content: "{}",
                    findings: "nope" as unknown as Finding[],
                }),
            ).rejects.toThrow(InvalidWorkflowInputError);
            const created = await database.workflows.createDraft({
                content: "{}",
                findings: [],
            });
            await expect(
                database.workflows.saveRevision(created.workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: "",
                    findings: [],
                }),
            ).rejects.toThrow(InvalidWorkflowInputError);
        });
    });
});

describe("publication", () => {
    test("publishes once per revision and returns the same publication", async () => {
        await withDatabase(async (database) => {
            const document = boundedLoopDocument();
            const validation = validator.validate(JSON.stringify(document));
            expect(validation.validForPublication).toBe(true);
            const created = await database.workflows.createDraft({
                content: JSON.stringify(document),
                findings: [],
            });
            const workflowId = created.workflowId;
            const input = await preparePublishInput(
                workflowId,
                created.revision.revisionId,
                document,
            );

            const first = await database.workflows.publish(input);
            expect(first).toEqual({ outcome: "published", publicationNumber: 1 });

            const repeat = await database.workflows.publish(input);
            expect(repeat).toEqual({ outcome: "already-published", publicationNumber: 1 });

            const concurrent = await Promise.all([
                database.workflows.publish(input),
                database.workflows.publish(input),
            ]);
            expect(
                concurrent.map((entry) =>
                    entry.outcome === "published" || entry.outcome === "already-published"
                        ? entry.publicationNumber
                        : -1,
                ),
            ).toEqual([1, 1]);

            const publication = await database.workflows.getPublication(workflowId, 1);
            expect(publication?.digest).toBe(input.digest);
            expect(publication?.canonicalText).toBe(input.canonicalText);
            expect(publication?.workflowFormatVersion).toBe("v1");
            expect(publication?.revisionId).toBe(created.revision.revisionId);
            expect(await database.workflows.getPublication(workflowId, 2)).toBeNull();
        });
    });

    test("returns typed not-found outcomes for unknown workflows and foreign revisions", async () => {
        await withDatabase(async (database) => {
            const created = await database.workflows.createDraft({
                content: JSON.stringify(boundedLoopDocument()),
                findings: [],
            });
            const workflowId = created.workflowId;

            // Unknown workflow: 404 via outcome, not a thrown error.
            expect(
                await database.workflows.publish({
                    workflowId: mintUuidV7(),
                    revisionId: created.revision.revisionId,
                    canonicalText: "{}",
                    digest: "a".repeat(64),
                    workflowFormatVersion: "v1",
                }),
            ).toEqual({ outcome: "not-found" });

            // The workflow exists, but the revision belongs to another one.
            const other = await database.workflows.createDraft({
                content: JSON.stringify(conditionalGroupsDocument("Other")),
                findings: [],
            });
            expect(
                await database.workflows.publish({
                    workflowId,
                    revisionId: other.revision.revisionId,
                    canonicalText: "{}",
                    digest: "a".repeat(64),
                    workflowFormatVersion: "v1",
                }),
            ).toEqual({ outcome: "revision-not-found" });

            // A revision id that never existed hits the same branch.
            expect(
                await database.workflows.publish({
                    workflowId,
                    revisionId: mintUuidV7(),
                    canonicalText: "{}",
                    digest: "a".repeat(64),
                    workflowFormatVersion: "v1",
                }),
            ).toEqual({ outcome: "revision-not-found" });
        });
    });

    test("keeps metadata-only edits digest-stable across versions", async () => {
        await withDatabase(async (database) => {
            const before = conditionalGroupsDocument("Original name");
            const created = await database.workflows.createDraft({
                content: JSON.stringify(before),
                findings: [],
            });
            const workflowId = created.workflowId;
            const firstInput = await preparePublishInput(
                workflowId,
                created.revision.revisionId,
                before,
            );
            expect((await database.workflows.publish(firstInput)).outcome).toBe("published");

            const after = conditionalGroupsDocument("Renamed display label");
            const renamed = savedRevision(
                await database.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: JSON.stringify(after),
                    findings: [],
                }),
            );
            const secondInput = await preparePublishInput(workflowId, renamed.revisionId, after);
            expect((await database.workflows.publish(secondInput)).outcome).toBe("published");

            expect(secondInput.digest).toBe(firstInput.digest);
            expect(secondInput.canonicalText).not.toBe(firstInput.canonicalText);
        });
    });

    test("leaves publications untouched by later draft work", async () => {
        await withDatabase(async (database) => {
            const document = boundedLoopDocument();
            const created = await database.workflows.createDraft({
                content: JSON.stringify(document),
                findings: [],
            });
            const workflowId = created.workflowId;
            const publishedInput = await preparePublishInput(
                workflowId,
                created.revision.revisionId,
                document,
            );
            expect((await database.workflows.publish(publishedInput)).outcome).toBe("published");

            await database.workflows.saveRevision(workflowId, {
                baseRevision: created.revision.revisionId,
                content: JSON.stringify(boundedLoopDocument("Edited after publish")),
                findings: [],
            });

            // The published bytes survive the later draft edit unchanged.
            const publication = await database.workflows.getPublication(workflowId, 1);
            expect(publication?.canonicalText).toBe(publishedInput.canonicalText);
            expect(publication?.digest).toBe(publishedInput.digest);
        });
    });

    test("fails verification when stored bytes are tampered with", async () => {
        await withDatabase(async (database) => {
            const document = boundedLoopDocument();
            const created = await database.workflows.createDraft({
                content: JSON.stringify(document),
                findings: [],
            });
            const workflowId = created.workflowId;
            await database.workflows.publish(
                await preparePublishInput(workflowId, created.revision.revisionId, document),
            );

            // A flipped digest must fail.
            await database.db
                .updateTable("publications")
                .set({ digest: "f".repeat(64) })
                .where("workflowId", "=", workflowId)
                .where("publicationNumber", "=", 1)
                .execute();
            await expect(database.workflows.getPublication(workflowId, 1)).rejects.toThrow(
                DigestVerificationError,
            );
        });
    });

    test("fails verification when stored bytes are non-canonical but the digest matches", async () => {
        await withDatabase(async (database) => {
            const document = boundedLoopDocument();
            const created = await database.workflows.createDraft({
                content: JSON.stringify(document),
                findings: [],
            });
            const workflowId = created.workflowId;
            await database.workflows.publish(
                await preparePublishInput(workflowId, created.revision.revisionId, document),
            );

            // Pretty-printed JSON is semantically identical and digest-equal
            // (the digest covers the canonical form), but it is not the
            // RFC 8785 canonical text: only the canonical-form branch of the
            // verification catches this replacement. The digest-flip test
            // covers the other branch.
            const stored = await database.workflows.getPublication(workflowId, 1);
            if (!stored) {
                throw new Error("expected a publication before tampering");
            }
            const pretty = JSON.stringify(JSON.parse(stored.canonicalText), null, 2);
            await database.db
                .updateTable("publications")
                .set({ canonicalText: pretty })
                .where("workflowId", "=", workflowId)
                .where("publicationNumber", "=", 1)
                .execute();
            await expect(database.workflows.getPublication(workflowId, 1)).rejects.toThrow(
                /not in RFC 8785 canonical form/,
            );
        });
    });
});
