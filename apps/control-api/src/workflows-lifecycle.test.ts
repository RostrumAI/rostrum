import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDatabase, migrateToLatest } from "@rostrum/database";
import { startTestPostgres } from "@rostrum/database/testing";
import { canonicalize, type Finding } from "@rostrum/workflow";
import graphCycleJson from "@rostrum/workflow/fixtures/incomplete/graph-cycle.json";
import minimumJson from "@rostrum/workflow/fixtures/valid/minimum.json";
import postgres from "postgres";
import { ControlApiApp } from "./app";
import { setWorkflowService, WorkflowService } from "./workflows/service";

// CI supplies DATABASE_URL; everywhere else the suite starts an embedded
// Postgres cluster, so the lifecycle runs wherever the repository clones
// and never requires a Docker daemon.
const testPostgres = await startTestPostgres();

const sql = postgres(testPostgres.url, { max: 1 });

const service = WorkflowService.create(testPostgres.url);

const app = (await ControlApiApp.create()).routes;

beforeAll(async () => {
    setWorkflowService(service);
    const db = createDatabase(testPostgres.url);
    try {
        await migrateToLatest(db);
    } finally {
        await db.destroy();
    }
});

afterAll(async () => {
    await service.close();
    setWorkflowService(null);
    await sql.end();
    await testPostgres.stop();
});

/** Fresh copies of the shared fixtures. */
function validDocument(): Record<string, unknown> {
    return structuredClone(minimumJson);
}

function blockingDocument(): Record<string, unknown> {
    return structuredClone(graphCycleJson);
}

async function fetchJson(path: string, init?: RequestInit) {
    const res = await app.fetch(new Request(`http://localhost${path}`, init));
    return { res, body: (await res.json()) as Record<string, unknown> };
}

function jsonRequest(body: unknown, init?: RequestInit): RequestInit {
    return {
        method: "POST",
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

/** Reproduces the published digest the way the contract tells a client to. */
async function clientDigestOf(content: string): Promise<string> {
    const document = JSON.parse(content) as Record<string, unknown>;
    delete document.name;
    delete document.description;
    const bytes = new TextEncoder().encode(canonicalize(document));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

/** Creates one draft from a document and returns the response body. */
async function createDraft(document: Record<string, unknown>) {
    const { res, body } = await fetchJson("/api/v1/workflows", jsonRequest(document));
    expect(res.status).toBe(201);
    return body;
}

describe("draft lifecycle", () => {
    test("validate, create, save, conflict, retrieve, rewind, publish, retrieve version", async () => {
        // Validate without saving: the same document validates cleanly.
        const document = { ...validDocument(), name: "Lifecycle workflow" };
        const validated = await fetchJson("/api/v1/workflows/validate", jsonRequest(document));
        expect(validated.res.status).toBe(200);
        expect(validated.body.findings).toEqual([]);
        expect(validated.body.validForPublication).toBe(true);

        // Create: a client-supplied id is replaced, never honored, and the
        // minted id is both returned and injected into the stored bytes.
        const withClientId = { ...document, id: "0192b0a0-7e1d-7000-8000-000000000999" };
        const created = await createDraft(withClientId);
        const workflowId = created.workflowId as string;
        expect(workflowId).not.toBe("0192b0a0-7e1d-7000-8000-000000000999");
        expect(JSON.parse(created.content as string).id).toBe(workflowId);
        expect(created.type).toBe("save");
        expect(created.findings).toEqual([]);
        const firstRevisionId = created.revisionId as string;

        // Save with the optimistic revision check.
        const secondText = JSON.stringify({ ...validDocument(), id: workflowId, name: "Renamed" });
        const saved = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions`,
            jsonRequest(secondText, { headers: { "Base-Revision": firstRevisionId } }),
        );
        expect(saved.res.status).toBe(200);
        expect(saved.body.revisionId).not.toBe(firstRevisionId);
        expect(saved.body.content).toBe(secondText);
        const secondRevisionId = saved.body.revisionId as string;

        // A stale base revision is a conflict carrying the current revision
        // and its findings, and it overwrites nothing.
        const stale = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions`,
            jsonRequest(JSON.stringify({ ...validDocument(), id: workflowId, name: "Lost race" }), {
                headers: { "Base-Revision": firstRevisionId },
            }),
        );
        expect(stale.res.status).toBe(409);
        expect(stale.body.code).toBe("revision_conflict");
        expect(stale.body.currentRevision).toBe(secondRevisionId);
        expect(stale.body.findings).toEqual([]);
        const afterConflict = await fetchJson(`/api/v1/workflows/${workflowId}`);
        expect(afterConflict.body.content).toBe(secondText);

        // Retrieval is byte-exact, both current and arbitrary.
        expect(afterConflict.res.status).toBe(200);
        expect(afterConflict.body.revisionId).toBe(secondRevisionId);
        const retrievedFirst = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions/${firstRevisionId}`,
        );
        expect(retrievedFirst.res.status).toBe(200);
        expect(retrievedFirst.body.content).toBe(created.content);

        // Rewind to the first revision: a copy becomes current, nothing is
        // deleted, and the published-source boundary does not exist.
        const rewound = await fetchJson(
            `/api/v1/workflows/${workflowId}/rewind`,
            jsonRequest({ targetRevisionId: firstRevisionId }),
        );
        expect(rewound.res.status).toBe(200);
        expect(rewound.body.type).toBe("rewind");
        expect(rewound.body.content).toBe(created.content);
        expect(rewound.body.revisionId).not.toBe(firstRevisionId);
        expect(rewound.body.revisionId).not.toBe(secondRevisionId);
        const survived = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions/${secondRevisionId}`,
        );
        expect(survived.res.status).toBe(200);
        expect(survived.body.content).toBe(secondText);

        // Publish the current revision, then re-publish idempotently.
        const published = await fetchJson(`/api/v1/workflows/${workflowId}/publish`, {
            method: "POST",
        });
        expect(published.res.status).toBe(200);
        expect(published.body).toEqual({
            workflowId,
            versionNumber: 1,
            interfaceVersion: "v1",
            digest: published.body.digest,
        });
        expect(published.body.digest).toMatch(/^[0-9a-f]{64}$/);
        const republished = await fetchJson(`/api/v1/workflows/${workflowId}/publish`, {
            method: "POST",
        });
        expect(republished.res.status).toBe(200);
        expect(republished.body).toEqual(published.body);

        // Retrieve the published version and reproduce the digest from the
        // stored canonical text per the response description.
        const version = await fetchJson(`/api/v1/workflows/${workflowId}/versions/1`);
        expect(version.res.status).toBe(200);
        expect(version.body.digest).toBe(published.body.digest);
        expect(version.body.revisionId).toBe(rewound.body.revisionId);
        expect(await clientDigestOf(version.body.content as string)).toBe(
            published.body.digest as string,
        );
        // A metadata-only edit never changes the digest.
        expect(JSON.parse(version.body.content as string).name).toBe("Lifecycle workflow");
    });

    test("the same blocking document yields identical findings through validate, save, and publish", async () => {
        const document = blockingDocument();

        const validated = await fetchJson("/api/v1/workflows/validate", jsonRequest(document));
        expect(validated.res.status).toBe(200);
        expect(validated.body.validForPublication).toBe(false);
        const validateFindings = validated.body.findings as Finding[];
        expect(validateFindings.length).toBeGreaterThan(0);

        const created = await createDraft(document);
        expect(created.findings).toEqual(validateFindings);

        const saved = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/revisions`,
            jsonRequest(JSON.stringify({ ...document, id: created.workflowId }), {
                headers: { "Base-Revision": created.revisionId as string },
            }),
        );
        expect(saved.res.status).toBe(200);
        expect(saved.body.findings).toEqual(validateFindings);

        const published = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/publish`,
            {
                method: "POST",
            },
        );
        expect(published.res.status).toBe(422);
        expect(published.body.code).toBe("workflow_not_valid");
        expect(published.body.findings).toEqual(validateFindings);
        expect(
            await fetchJson(`/api/v1/workflows/${created.workflowId as string}/versions/1`),
        ).toMatchObject({ res: expect.objectContaining({ status: 404 }) });
    });
});

describe("parse failures and malformed input", () => {
    test("invalid JSON answers 400 with the parse finding and creates nothing", async () => {
        const before = Number((await sql`select count(*) as count from workflows`)[0]?.count);
        const response = await fetchJson(
            "/api/v1/workflows/validate",
            jsonRequest(`{"name": "broken",,}`),
        );
        expect(response.res.status).toBe(400);
        expect(response.body.code).toBe("invalid_workflow_input");
        const findings = response.body.findings as Finding[];
        expect(findings[0]?.code).toBe("workflow.parse.json-invalid");
        expect(findings[0]?.line).toBe(1);
        const after = Number((await sql`select count(*) as count from workflows`)[0]?.count);
        expect(after).toBe(before);
    });

    test("duplicate keys and NaN are 400, never drafts", async () => {
        for (const text of [`{"name":"a","name":"b"}`, `{"name":NaN}`]) {
            const response = await fetchJson("/api/v1/workflows/validate", jsonRequest(text));
            expect(response.res.status).toBe(400);
            expect(response.body.code).toBe("invalid_workflow_input");
        }
    });

    test("a save without a Base-Revision header is 400", async () => {
        const created = await createDraft(validDocument());
        const response = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/revisions`,
            jsonRequest(JSON.stringify(validDocument())),
        );
        expect(response.res.status).toBe(400);
        expect(response.body.code).toBe("invalid_workflow_input");
    });

    test("a malformed Base-Revision header is 400", async () => {
        const created = await createDraft(validDocument());
        const response = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/revisions`,
            jsonRequest(JSON.stringify(validDocument()), {
                headers: { "Base-Revision": "not-a-uuid" },
            }),
        );
        expect(response.res.status).toBe(400);
        expect(response.body.code).toBe("invalid_workflow_input");
    });

    test("a malformed rewind body is 400", async () => {
        const created = await createDraft(validDocument());
        for (const body of [
            `not json`,
            JSON.stringify({}),
            JSON.stringify({ targetRevisionId: 5 }),
        ]) {
            const response = await fetchJson(
                `/api/v1/workflows/${created.workflowId as string}/rewind`,
                jsonRequest(body),
            );
            expect(response.res.status).toBe(400);
            expect(response.body.code).toBe("invalid_workflow_input");
        }
    });

    test("a non-integer or zero version number is 400", async () => {
        const created = await createDraft(validDocument());
        for (const versionNumber of ["zero", "0", "-1", "1.5"]) {
            const response = await fetchJson(
                `/api/v1/workflows/${created.workflowId as string}/versions/${versionNumber}`,
            );
            expect(response.res.status).toBe(400);
            expect(response.body.code).toBe("invalid_workflow_input");
        }
    });
});

describe("identity handling", () => {
    test("a save that omits the id gets it injected and echoed", async () => {
        const created = await createDraft(validDocument());
        const workflowId = created.workflowId as string;
        const withoutId = { interfaceVersion: "v1", name: "No id" };
        const saved = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions`,
            jsonRequest(JSON.stringify(withoutId), {
                headers: { "Base-Revision": created.revisionId as string },
            }),
        );
        expect(saved.res.status).toBe(200);
        expect(JSON.parse(saved.body.content as string)).toEqual({
            ...withoutId,
            id: workflowId,
        });
    });

    test("a save whose embedded id disagrees is a 409 identity conflict", async () => {
        const created = await createDraft(validDocument());
        const workflowId = created.workflowId as string;
        const response = await fetchJson(
            `/api/v1/workflows/${workflowId}/revisions`,
            jsonRequest(
                JSON.stringify({ ...validDocument(), id: "0192b0a0-7e1d-7000-8000-000000000888" }),
                { headers: { "Base-Revision": created.revisionId as string } },
            ),
        );
        expect(response.res.status).toBe(409);
        expect(response.body.code).toBe("identity_conflict");
    });

    test("a save with a non-string embedded id is a 409 identity conflict", async () => {
        const created = await createDraft(validDocument());
        const response = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/revisions`,
            jsonRequest(JSON.stringify({ ...validDocument(), id: 42 }), {
                headers: { "Base-Revision": created.revisionId as string },
            }),
        );
        expect(response.res.status).toBe(409);
        expect(response.body.code).toBe("identity_conflict");
    });

    test("an id collision on creation is a 409 duplicate_workflow_id", async () => {
        const fixedId = "0192b0a0-7e1d-7000-8000-0000000000f1";
        await sql`insert into workflows (id) values (${fixedId})`;
        const colliding = WorkflowService.create(testPostgres.url, () => fixedId);
        setWorkflowService(colliding);
        try {
            const response = await fetchJson("/api/v1/workflows", jsonRequest(validDocument()));
            expect(response.res.status).toBe(409);
            expect(response.body.code).toBe("duplicate_workflow_id");
        } finally {
            setWorkflowService(service);
            await colliding.close();
        }
    });
});

describe("unknown addresses", () => {
    const unknownWorkflow = "0192b0a0-7e1d-7000-8000-0000000000e1";
    const unknownRevision = "0192b0a0-7e1d-7000-8000-0000000000e2";

    test("draft, revision, rewind, publish, and version of an unknown workflow are 404", async () => {
        const draft = await fetchJson(`/api/v1/workflows/${unknownWorkflow}`);
        expect(draft.res.status).toBe(404);
        expect(draft.body.code).toBe("not_found");

        const saved = await fetchJson(
            `/api/v1/workflows/${unknownWorkflow}/revisions`,
            jsonRequest(JSON.stringify(validDocument()), {
                headers: { "Base-Revision": unknownRevision },
            }),
        );
        expect(saved.res.status).toBe(404);
        expect(saved.body.code).toBe("not_found");

        const rewound = await fetchJson(
            `/api/v1/workflows/${unknownWorkflow}/rewind`,
            jsonRequest({ targetRevisionId: unknownRevision }),
        );
        expect(rewound.res.status).toBe(404);
        expect(rewound.body.code).toBe("not_found");

        const published = await fetchJson(`/api/v1/workflows/${unknownWorkflow}/publish`, {
            method: "POST",
        });
        expect(published.res.status).toBe(404);
        expect(published.body.code).toBe("not_found");

        const version = await fetchJson(`/api/v1/workflows/${unknownWorkflow}/versions/1`);
        expect(version.res.status).toBe(404);
        expect(version.body.code).toBe("not_found");
    });

    test("an unknown revision of an existing workflow is 404", async () => {
        const created = await createDraft(validDocument());
        const revision = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/revisions/${unknownRevision}`,
        );
        expect(revision.res.status).toBe(404);
        expect(revision.body.code).toBe("not_found");

        const rewound = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/rewind`,
            jsonRequest({ targetRevisionId: unknownRevision }),
        );
        expect(rewound.res.status).toBe(404);
        expect(rewound.body.code).toBe("revision_not_found");
    });

    test("a malformed workflow id path is 400", async () => {
        const response = await fetchJson("/api/v1/workflows/not-a-uuid");
        expect(response.res.status).toBe(400);
        expect(response.body.code).toBe("invalid_workflow_input");
    });
});

describe("rewind edge cases", () => {
    test("rewinding to the current revision is a no-op", async () => {
        const created = await createDraft(validDocument());
        const response = await fetchJson(
            `/api/v1/workflows/${created.workflowId as string}/rewind`,
            jsonRequest({ targetRevisionId: created.revisionId }),
        );
        expect(response.res.status).toBe(200);
        expect(response.body.revisionId).toBe(created.revisionId);
        expect(response.body.type).toBe("save");
    });
});

describe("storage failure mapping", () => {
    test("a corrupt findings snapshot surfaces as 500 internal_error", async () => {
        const created = await createDraft(validDocument());
        const workflowId = created.workflowId as string;
        await sql`update revisions set findings = 'not json' where workflow_id = ${workflowId}`;
        const response = await fetchJson(`/api/v1/workflows/${workflowId}`);
        expect(response.res.status).toBe(500);
        expect(response.body.code).toBe("internal_error");
        expect(response.body.findings).toEqual([]);
    });

    test("a tampered published digest surfaces as 500 internal_error", async () => {
        const created = await createDraft(validDocument());
        const workflowId = created.workflowId as string;
        const published = await fetchJson(`/api/v1/workflows/${workflowId}/publish`, {
            method: "POST",
        });
        expect(published.res.status).toBe(200);
        await sql`update published_versions set digest = ${"0".repeat(64)} where workflow_id = ${workflowId}`;
        const response = await fetchJson(`/api/v1/workflows/${workflowId}/versions/1`);
        expect(response.res.status).toBe(500);
        expect(response.body.code).toBe("internal_error");
    });
});
