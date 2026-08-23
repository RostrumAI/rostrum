import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
    createWorkflowValidator,
    type Finding,
    PublicationPreparer,
    V1_RULE_SET,
} from "@rostrum/workflow";
import { sql } from "kysely";
import { Migrator, NO_MIGRATIONS } from "kysely/migration";
import {
    type CreatedDraft,
    createStorage,
    DigestVerificationError,
    migrateToLatest,
    mintUuidV7,
    type PublishInput,
    type RostrumStorage,
    SqlFileMigrationProvider,
    type StoredRevision,
} from "../src";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://rostrum:rostrum@localhost:5432/rostrum";

async function isDatabaseReachable(): Promise<boolean> {
    const { default: postgres } = await import("postgres");
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3 });
    try {
        await sql`select 1`;
        return true;
    } catch {
        return false;
    } finally {
        await sql.end();
    }
}

const databaseAvailable = await isDatabaseReachable();
if (!databaseAvailable) {
    console.warn(
        "Postgres is not reachable; storage tests are skipped. Start it with: bun run db:up",
    );
}

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
 * The specification's valid sequential example; every document a test
 * publishes passes the real validator as a sanity gate first.
 */
function greetDocument(name = "Greet and summarize"): Record<string, unknown> {
    return {
        interfaceVersion: "v1",
        id: "0192b0a0-7e1d-7000-8000-000000000001",
        name,
        description: "Bind a name, produce a greeting, return it.",
        firstNode: "0192b0a0-7e1d-7000-8000-000000000002",
        inputs: { name: { type: "string" } },
        steps: [
            {
                id: "0192b0a0-7e1d-7000-8000-000000000002",
                type: "task",
                config: { operation: "grüß 😀" },
                inputs: { name: { ref: "inputs.name" } },
                outputs: { greeting: { type: "string" } },
                successors: ["0192b0a0-7e1d-7000-8000-000000000003"],
            },
            {
                id: "0192b0a0-7e1d-7000-8000-000000000003",
                type: "result",
                inputs: { greeting: { ref: "step.0192b0a0-7e1d-7000-8000-000000000002.greeting" } },
            },
        ],
    };
}

/** Raw submitted bytes with CRLF line endings and an escaped NUL member. */
const RAW_NUL_CONTENT = `{
  "interfaceVersion": "v1",\r
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
        interfaceVersion: document.interfaceVersion as string,
    };
}

async function countRevisions(storage: RostrumStorage, workflowId: string): Promise<number> {
    const rows = await storage.db
        .selectFrom("revisions")
        .select((eb) => eb.fn.countAll().as("count"))
        .where("workflowId", "=", workflowId)
        .executeTakeFirstOrThrow();
    return Number(rows.count);
}

async function revisionIds(storage: RostrumStorage, workflowId: string): Promise<string[]> {
    const rows = await storage.db
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

/** Opens one migrated storage with empty tables and closes it afterwards. */
async function withStorage<T>(run: (storage: RostrumStorage) => Promise<T>): Promise<T> {
    const storage = createStorage(databaseUrl);
    try {
        await migrateToLatest(storage.db);
        await sql`TRUNCATE published_versions, revisions, workflows`.execute(storage.db);
        return await run(storage);
    } finally {
        await storage.close();
    }
}
describe("migrations", () => {
    test.skipIf(!databaseAvailable)(
        "roll back fully, reapply, and rerun idempotently",
        async () => {
            await withStorage(async (storage) => {
                const migrator = new Migrator({
                    db: storage.db,
                    provider: new SqlFileMigrationProvider(join(import.meta.dir, "../migrations")),
                });
                const down = await migrator.migrateTo(NO_MIGRATIONS);
                expect(down.error).toBeUndefined();

                const remaining =
                    await sql`select table_name from information_schema.tables where table_name = 'revisions'`.execute(
                        storage.db,
                    );
                expect(remaining.rows).toEqual([]);

                const up = await migrateToLatest(storage.db);
                expect(up.map((entry) => entry.migrationName)).toEqual([
                    "001_workflows",
                    "002_revisions",
                    "003_published_versions",
                ]);

                const again = await migrateToLatest(storage.db);
                expect(again).toHaveLength(0);
            });
        },
    );
});

describe("drafts and revisions", () => {
    test.skipIf(!databaseAvailable)(
        "createDraft stores the first revision byte-exactly",
        async () => {
            await withStorage(async (storage) => {
                const content = JSON.stringify(greetDocument(), null, 4);
                const created = await storage.workflows.createDraft({
                    workflowId: mintUuidV7(),
                    content,
                    findings: [],
                });
                expect(created.revision.content).toBe(content);

                const current = await storage.workflows.getCurrentRevision(created.workflowId);
                expect(current?.revisionId).toBe(created.revision.revisionId);
                expect(current?.content).toBe(content);
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "round-trips CRLF text, Unicode, and escaped NUL bytes",
        async () => {
            await withStorage(async (storage) => {
                const created = await storage.workflows.createDraft({
                    workflowId: mintUuidV7(),
                    content: RAW_NUL_CONTENT,
                    findings: FINDINGS_DRAFT,
                });
                const stored = await storage.workflows.getRevision(
                    created.workflowId,
                    created.revision.revisionId,
                );
                expect(stored?.content).toBe(RAW_NUL_CONTENT);
                expect(stored?.findings).toEqual(FINDINGS_DRAFT);
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "rejects stale baseRevision values with the current revision",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: '{"v":1}',
                    findings: FINDINGS_DRAFT,
                });

                // A null base after creation means the client never saw a revision.
                const staleNull = await storage.workflows.saveRevision(workflowId, {
                    baseRevision: null,
                    content: '{"v":2}',
                    findings: [],
                });
                expect(staleNull.outcome).toBe("conflict");
                if (staleNull.outcome === "conflict") {
                    expect(staleNull.currentRevision.revisionId).toBe(created.revision.revisionId);
                }

                const secondRevision = savedRevision(
                    await storage.workflows.saveRevision(workflowId, {
                        baseRevision: created.revision.revisionId,
                        content: '{"v":2}',
                        findings: [],
                    }),
                );

                // Replaying the first save's base must not overwrite newer work.
                const replayed = await storage.workflows.saveRevision(workflowId, {
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
                        findings: [],
                        createdAt: secondRevision.createdAt,
                    },
                });

                expect(await countRevisions(storage, workflowId)).toBe(2);
                expect(await storage.workflows.getCurrentRevision(workflowId)).toMatchObject({
                    content: '{"v":2}',
                });
            });
        },
    );

    test.skipIf(!databaseAvailable)("reports unknown workflows on save", async () => {
        await withStorage(async (storage) => {
            const result = await storage.workflows.saveRevision(mintUuidV7(), {
                baseRevision: null,
                content: "{}",
                findings: [],
            });
            expect(result.outcome).toBe("not-found");
        });
    });

    test.skipIf(!databaseAvailable)(
        "survives a full connection restart byte-for-byte",
        async () => {
            let created: CreatedDraft;
            {
                const first = createStorage(databaseUrl);
                try {
                    await migrateToLatest(first.db);
                    await sql`TRUNCATE published_versions, revisions, workflows`.execute(first.db);
                    const document = greetDocument("Restart durable");
                    created = await first.workflows.createDraft({
                        workflowId: mintUuidV7(),
                        content: JSON.stringify(document),
                        findings: [],
                    });
                    const input = await preparePublishInput(
                        created.workflowId,
                        created.revision.revisionId,
                        document,
                    );
                    await first.workflows.publish(input);
                } finally {
                    await first.close();
                }
            }
            {
                const reopened = createStorage(databaseUrl);
                try {
                    const draft = await reopened.workflows.getRevision(
                        created.workflowId,
                        created.revision.revisionId,
                    );
                    expect(draft?.content).toBe(created.revision.content);
                    const version = await reopened.workflows.getPublishedVersion(
                        created.workflowId,
                        1,
                    );
                    expect(version?.digest).toBeDefined();
                } finally {
                    await reopened.close();
                }
            }
        },
    );
});

describe("rewind", () => {
    test.skipIf(!databaseAvailable)("deletes newer revisions and repoints the draft", async () => {
        await withStorage(async (storage) => {
            const workflowId = mintUuidV7();
            const created = await storage.workflows.createDraft({
                workflowId,
                content: '{"v":1}',
                findings: [],
            });
            const second = savedRevision(
                await storage.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: '{"v":2}',
                    findings: [],
                }),
            );
            const third = savedRevision(
                await storage.workflows.saveRevision(workflowId, {
                    baseRevision: second.revisionId,
                    content: '{"v":3}',
                    findings: [],
                }),
            );

            const rewound = await storage.workflows.rewind(workflowId, created.revision.revisionId);
            expect(rewound.outcome).toBe("rewound");
            expect(
                rewound.outcome === "rewound" ? [...rewound.deletedRevisionIds].sort() : [],
            ).toEqual([second.revisionId, third.revisionId].sort());

            const current = await storage.workflows.getCurrentRevision(workflowId);
            expect(current?.revisionId).toBe(created.revision.revisionId);
            expect(await countRevisions(storage, workflowId)).toBe(1);

            // Saves continue after the rewind point.
            const resumed = await storage.workflows.saveRevision(workflowId, {
                baseRevision: created.revision.revisionId,
                content: '{"v":4}',
                findings: [],
            });
            expect(resumed.outcome).toBe("saved");
        });
    });

    test.skipIf(!databaseAvailable)(
        "treats rewinding to the current revision as a no-op",
        async () => {
            await withStorage(async (storage) => {
                const created = await storage.workflows.createDraft({
                    workflowId: mintUuidV7(),
                    content: '{"v":1}',
                    findings: [],
                });
                expect(
                    await storage.workflows.rewind(created.workflowId, created.revision.revisionId),
                ).toEqual({ outcome: "no-op" });
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "refuses targets older than the newest published source",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const document = greetDocument();
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: JSON.stringify(document),
                    findings: [],
                });
                const second = savedRevision(
                    await storage.workflows.saveRevision(workflowId, {
                        baseRevision: created.revision.revisionId,
                        content: JSON.stringify(greetDocument("Renamed")),
                        findings: [],
                    }),
                );

                // Publish from the second revision, then try to rewind past it.
                const input = await preparePublishInput(
                    workflowId,
                    second.revisionId,
                    greetDocument("Renamed"),
                );
                await storage.workflows.publish(input);

                const refused = await storage.workflows.rewind(
                    workflowId,
                    created.revision.revisionId,
                );
                expect(refused).toEqual({
                    outcome: "refused",
                    publishedSourceRevisionId: input.revisionId,
                });
                expect(await revisionIds(storage, workflowId)).toEqual([
                    created.revision.revisionId,
                    input.revisionId,
                ]);

                // Rewinding TO the published source stays allowed.
                expect(await storage.workflows.rewind(workflowId, input.revisionId)).toEqual({
                    outcome: "no-op",
                });
            });
        },
    );

    test.skipIf(!databaseAvailable)("reports missing workflows and targets", async () => {
        await withStorage(async (storage) => {
            expect(await storage.workflows.rewind(mintUuidV7(), mintUuidV7())).toEqual({
                outcome: "not-found",
            });
            const created = await storage.workflows.createDraft({
                workflowId: mintUuidV7(),
                content: "{}",
                findings: [],
            });
            expect(await storage.workflows.rewind(created.workflowId, mintUuidV7())).toEqual({
                outcome: "target-not-found",
            });
        });
    });
});

describe("publication", () => {
    test.skipIf(!databaseAvailable)(
        "publishes once per revision and returns the same version",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const document = greetDocument();
                const validation = validator.validate(JSON.stringify(document));
                expect(validation.validForPublication).toBe(true);
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: JSON.stringify(document),
                    findings: [],
                });
                const input = await preparePublishInput(
                    workflowId,
                    created.revision.revisionId,
                    document,
                );

                const first = await storage.workflows.publish(input);
                expect(first).toEqual({ outcome: "published", versionNumber: 1 });

                const repeat = await storage.workflows.publish(input);
                expect(repeat).toEqual({ outcome: "already-published", versionNumber: 1 });

                const concurrent = await Promise.all([
                    storage.workflows.publish(input),
                    storage.workflows.publish(input),
                ]);
                expect(concurrent.map((entry) => entry.versionNumber)).toEqual([1, 1]);

                const version = await storage.workflows.getPublishedVersion(workflowId, 1);
                expect(version?.digest).toBe(input.digest);
                expect(version?.canonicalText).toBe(input.canonicalText);
                expect(version?.interfaceVersion).toBe("v1");
                expect(version?.revisionId).toBe(created.revision.revisionId);
                expect(await storage.workflows.getPublishedVersion(workflowId, 2)).toBeNull();
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "keeps metadata-only edits digest-stable across versions",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const before = greetDocument("Original name");
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: JSON.stringify(before),
                    findings: [],
                });
                const firstInput = await preparePublishInput(
                    workflowId,
                    created.revision.revisionId,
                    before,
                );
                expect((await storage.workflows.publish(firstInput)).outcome).toBe("published");

                const after = greetDocument("Renamed display label");
                const renamed = savedRevision(
                    await storage.workflows.saveRevision(workflowId, {
                        baseRevision: created.revision.revisionId,
                        content: JSON.stringify(after),
                        findings: [],
                    }),
                );
                const secondInput = await preparePublishInput(
                    workflowId,
                    renamed.revisionId,
                    after,
                );
                expect((await storage.workflows.publish(secondInput)).outcome).toBe("published");

                expect(secondInput.digest).toBe(firstInput.digest);
                expect(secondInput.canonicalText).not.toBe(firstInput.canonicalText);
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "leaves published versions untouched by later draft work",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const document = greetDocument();
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: JSON.stringify(document),
                    findings: [],
                });
                const publishedInput = await preparePublishInput(
                    workflowId,
                    created.revision.revisionId,
                    document,
                );
                expect((await storage.workflows.publish(publishedInput)).outcome).toBe("published");

                await storage.workflows.saveRevision(workflowId, {
                    baseRevision: created.revision.revisionId,
                    content: JSON.stringify(greetDocument("Edited after publish")),
                    findings: [],
                });

                // The published bytes survive the later draft edit unchanged.
                const version = await storage.workflows.getPublishedVersion(workflowId, 1);
                expect(version?.canonicalText).toBe(publishedInput.canonicalText);
                expect(version?.digest).toBe(publishedInput.digest);
            });
        },
    );

    test.skipIf(!databaseAvailable)(
        "fails verification when stored bytes are tampered with",
        async () => {
            await withStorage(async (storage) => {
                const workflowId = mintUuidV7();
                const document = greetDocument();
                const created = await storage.workflows.createDraft({
                    workflowId,
                    content: JSON.stringify(document),
                    findings: [],
                });
                await storage.workflows.publish(
                    await preparePublishInput(workflowId, created.revision.revisionId, document),
                );

                // A flipped digest must fail.
                await storage.db
                    .updateTable("publishedVersions")
                    .set({ digest: "f".repeat(64) })
                    .where("workflowId", "=", workflowId)
                    .where("versionNumber", "=", 1)
                    .execute();
                await expect(storage.workflows.getPublishedVersion(workflowId, 1)).rejects.toThrow(
                    DigestVerificationError,
                );
            });
        },
    );
});
