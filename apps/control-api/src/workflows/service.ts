import type {
    CreatedDraft,
    PublishedVersion,
    PublishResult,
    SaveRevisionResult,
    StoredRevision,
} from "@rostrum/database";
import {
    type Finding,
    type InterfaceRuleSet,
    type PublicationPreparation,
    PublicationPreparer,
    type RuleSetRegistry,
    type ValidationResult,
    type WorkflowValidator,
} from "@rostrum/workflow";
import { v7 as mintUuidV7 } from "uuid";
import { loadConfig } from "../env";
import { createWorkflowDatabase, type WorkflowDatabase } from "./database";
import { insertWorkflowId, isJsonObject, parseWorkflow, replaceWorkflowId } from "./documents";
import { identityConflict, parseFailure, WorkflowApiError } from "./errors";
import { RULE_SET_REGISTRY, WORKFLOW_VALIDATOR } from "./rule-sets";

/** The explicit validation result of POST /workflows/validate. */
export interface ValidateOutcome {
    readonly findings: readonly Finding[];
    readonly validForPublication: boolean;
}

/**
 * The result of one publish attempt. Successful outcomes carry the
 * interface version and digest the API answers with, computed from the
 * current revision's validated document; idempotent re-publishes return
 * the same values, since the digest is deterministic on the revision's
 * content.
 */
export type PublishWorkflowResult =
    | {
          outcome: "published" | "already-published";
          versionNumber: number;
          interfaceVersion: string;
          digest: string;
      }
    | { outcome: "blocking-findings"; findings: readonly Finding[] }
    | { outcome: "not-found" }
    | { outcome: "revision-not-found" };

/**
 * The workflow-authoring operations over one workflow database: parse,
 * validate, store drafts and revisions, rewind, publish, and retrieve
 * published versions. Validation runs on the text that will be stored,
 * so the findings a save returns anchor to the bytes retrieval returns.
 */
export class WorkflowService {
    private readonly database: WorkflowDatabase;
    private readonly validator: WorkflowValidator;
    private readonly registry: RuleSetRegistry;
    private readonly mintWorkflowId: () => string;

    private constructor(
        database: WorkflowDatabase,
        validator: WorkflowValidator,
        registry: RuleSetRegistry,
        mintWorkflowId: () => string,
    ) {
        this.database = database;
        this.validator = validator;
        this.registry = registry;
        this.mintWorkflowId = mintWorkflowId;
    }

    /**
     * Creates a service over one Postgres URL. Tests pass a fixed mint to
     * induce id collisions; production keeps the default UUID v7 mint.
     */
    static create(databaseUrl: string, mintWorkflowId: () => string = mintUuidV7): WorkflowService {
        return new WorkflowService(
            createWorkflowDatabase(databaseUrl),
            WORKFLOW_VALIDATOR,
            RULE_SET_REGISTRY,
            mintWorkflowId,
        );
    }

    /** Validates raw workflow JSON without saving it. Parse failures raise a 400-mapped error. */
    async validate(input: string | Uint8Array): Promise<ValidateOutcome> {
        const parsed = parseWorkflow(input);
        if (!parsed.ok) throw new WorkflowApiError(parseFailure(parsed.findings));
        const result = this.validator.validate(parsed.text);
        return { findings: result.findings, validForPublication: result.validForPublication };
    }

    /**
     * Creates a draft: mints the workflow `id`, injects it into the stored
     * document (an author-supplied `id` is replaced, never honored), and

     * stores the injected text as the first revision. Documents that are
     * not JSON objects are stored as submitted; validation reports the
     * shape finding and the save still succeeds.
     */
    async createDraft(input: Uint8Array, name: string | null): Promise<CreatedDraft> {
        const parsed = parseWorkflow(input);
        if (!parsed.ok) throw new WorkflowApiError(parseFailure(parsed.findings));
        const workflowId = this.mintWorkflowId();
        const text = isJsonObject(parsed.document)
            ? replaceWorkflowId(parsed.text, workflowId)
            : parsed.text;
        const result = this.validateStoredText(text);
        return this.database.workflows.createDraft({
            workflowId,
            content: text,
            findings: result.findings,
            name,
        });
    }

    /**
     * Saves one revision behind the optimistic `baseRevision` check. A
     * saved document that omits the `id` gets the addressed workflow's id
     * injected; one whose embedded `id` is present but not exactly the
     * addressed id is an identity conflict, never a silent cross-workflow
     * write.
     */
    async saveRevision(
        workflowId: string,
        input: Uint8Array,
        baseRevision: string,
        name: string | null,
    ): Promise<SaveRevisionResult> {
        const parsed = parseWorkflow(input);
        if (!parsed.ok) throw new WorkflowApiError(parseFailure(parsed.findings));
        let text = parsed.text;
        if (isJsonObject(parsed.document)) {
            const embeddedId = parsed.document.id;
            if (embeddedId === undefined) {
                text = insertWorkflowId(parsed.text, workflowId);
            } else if (embeddedId !== workflowId) {
                // The addressed workflow is authoritative: when it does not
                // exist the save is 404, and the embedded-id disagreement
                // only matters against a workflow that exists.
                const current = await this.database.workflows.getCurrentRevision(workflowId);
                if (!current) return { outcome: "not-found" };
                throw new WorkflowApiError(
                    identityConflict(
                        `The document's embedded id ${JSON.stringify(embeddedId)} does not match the addressed workflow ${workflowId}`,
                    ),
                );
            }
        }
        const result = this.validateStoredText(text);
        return this.database.workflows.saveRevision(workflowId, {
            baseRevision,
            content: text,
            findings: result.findings,
            name,
        });
    }

    /** Returns the draft's current revision, or null when the workflow does not exist. */
    async currentRevision(workflowId: string): Promise<StoredRevision | null> {
        return this.database.workflows.getCurrentRevision(workflowId);
    }

    /** Returns one stored revision byte-exact, or null when it does not exist. */
    async revision(workflowId: string, revisionId: string): Promise<StoredRevision | null> {
        return this.database.workflows.getRevision(workflowId, revisionId);
    }

    /**
     * Rewinds the draft to an earlier revision. A rewind to the current
     * revision is a no-op whose answer is the unchanged current revision,
     * so every success carries the revision the draft now shows.
     */
    async rewind(
        workflowId: string,
        targetRevisionId: string,
    ): Promise<
        | { outcome: "rewound" | "no-op"; revision: StoredRevision }
        | { outcome: "target-not-found" }
        | { outcome: "not-found" }
    > {
        const result = await this.database.workflows.rewind(workflowId, targetRevisionId);
        switch (result.outcome) {
            case "rewound":
                return result;
            case "no-op": {
                const current = await this.database.workflows.getCurrentRevision(workflowId);
                if (!current) throw new Error(`workflow ${workflowId} has no current revision`);
                return { outcome: "no-op", revision: current };
            }
            default:
                return result;
        }
    }

    /**
     * Publishes the draft's current revision: re-validates the stored
     * content, selects the declared version's rule set by exact match, and
     * stores the canonical text under the next per-workflow version number.
     * Republishing the same revision returns the existing version.
     */
    async publish(workflowId: string): Promise<PublishWorkflowResult> {
        const current = await this.database.workflows.getCurrentRevision(workflowId);
        if (!current) return { outcome: "not-found" };
        const result = this.validator.validate(current.content);
        if (!result.validForPublication) {
            return { outcome: "blocking-findings", findings: result.findings };
        }
        const parsed = parseWorkflow(current.content);
        // Validation passed, so the stored text parses strictly; a failure
        // here means stored state regressed below the write guard.
        if (!parsed.ok || !isJsonObject(parsed.document)) {
            throw new Error(`stored revision ${current.revisionId} is not a JSON object`);
        }
        const { ruleSet, interfaceVersion } = this.selectRuleSet(parsed.document);
        const prepared = await new PublicationPreparer(ruleSet).prepare(parsed.document);
        const stored = await this.database.workflows.publish({
            workflowId,
            revisionId: current.revisionId,
            canonicalText: prepared.canonicalText,
            digest: prepared.digest,
            interfaceVersion,
        });
        return this.publishResult(stored, interfaceVersion, prepared);
    }

    /** Returns one published version after storage-side digest verification, or null. */
    async publishedVersion(
        workflowId: string,
        versionNumber: number,
    ): Promise<PublishedVersion | null> {
        return this.database.workflows.getPublishedVersion(workflowId, versionNumber);
    }

    /** Closes the underlying connection pool. */
    async close(): Promise<void> {
        await this.database.close();
    }

    /**
     * Validates the text that will be stored, so stored findings anchor to
     * the bytes retrieval returns. The text parsed strictly already; a
     * parse failure at this point is an invariant violation.
     */
    private validateStoredText(text: string): ValidationResult {
        return this.validator.validate(text);
    }

    /** Selects the declared interface version's rule set by exact match. */
    private selectRuleSet(document: Record<string, unknown>): {
        ruleSet: InterfaceRuleSet;
        interfaceVersion: string;
    } {
        const declared = document.interfaceVersion;
        if (typeof declared !== "string") {
            throw new Error("validated document declares a non-string interfaceVersion");
        }
        const ruleSet = this.registry.select(declared);
        // An unknown version is a blocking finding, so a validated document
        // never reaches this line with an unselectable version.
        if (ruleSet === undefined) {
            throw new Error(`no rule set registered for validated version '${declared}'`);
        }
        return { ruleSet, interfaceVersion: declared };
    }

    /** Maps the storage outcome onto the API result, adding the computed publication values. */
    private publishResult(
        stored: PublishResult,
        interfaceVersion: string,
        prepared: PublicationPreparation,
    ): PublishWorkflowResult {
        switch (stored.outcome) {
            case "published":
            case "already-published":
                return {
                    outcome: stored.outcome,
                    versionNumber: stored.versionNumber,
                    interfaceVersion,
                    digest: prepared.digest,
                };
            default:
                return stored;
        }
    }
}

/**
 * Maps one stored revision onto the WorkflowRevision response shape, the
 * uniform body of create, save, rewind, and both revisions' retrievals.
 */
export function revisionResponse(revision: StoredRevision): {
    workflowId: string;
    revisionId: string;
    name: string | null;
    type: string;
    content: string;
    findings: readonly Finding[];
} {
    return {
        workflowId: revision.workflowId,
        revisionId: revision.revisionId,
        name: revision.name,
        type: revision.type,
        content: revision.content,
        findings: revision.findings,
    };
}

let instance: WorkflowService | null = null;

/**
 * Returns the process-wide workflow service, building it against the
 * configured database on first use. The lazy build keeps the foundation
 * tests, which never hit a workflow route, free of database connections.
 */
export function workflowService(): WorkflowService {
    if (instance === null) {
        instance = WorkflowService.create(loadConfig().databaseUrl);
    }
    return instance;
}

/**
 * Replaces the process-wide service. Integration tests point it at a
 * disposable database before driving the app; passing null clears it so a
 * later test run rebuilds against the configured database.
 */
export function setWorkflowService(service: WorkflowService | null): void {
    instance = service;
}

/** Closes the process-wide service when one was built; a no-op otherwise. */
export async function closeWorkflowService(): Promise<void> {
    if (instance !== null) {
        await instance.close();
        instance = null;
    }
}
