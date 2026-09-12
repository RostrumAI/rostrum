import type {
    CreatedDraft,
    DatabaseHandle,
    Publication,
    PublishResult,
    SaveRevisionResult,
    StoredRevision,
} from "@rostrum/database";
import { WorkflowRepository } from "@rostrum/database";
import {
    type Finding,
    insertWorkflowId,
    type PublicationPreparation,
    PublicationPreparer,
    parseWorkflow,
    replaceWorkflowId,
    V1_RULE_SET,
    type ValidationResult,
    type WorkflowFormatRegistry,
    type WorkflowFormatRuleSet,
    type WorkflowValidator,
} from "@rostrum/workflow";
import { v7 as mintUuidV7 } from "uuid";
import { WorkflowApiError, workflowIdentityConflict, workflowParseFailure } from "./errors";
import { RULE_SET_REGISTRY, WORKFLOW_VALIDATOR } from "./rule-sets";

/** The explicit validation result of POST /workflows/validate. */
export interface ValidateOutcome {
    readonly findings: readonly Finding[];
    readonly validForPublication: boolean;
}

/**
 * The result of one publish attempt. Successful outcomes carry the
 * format version and digest the API answers with, computed from the
 * current revision's validated document; idempotent re-publishes return
 * the same values, since the digest is deterministic on the revision's
 * content.
 */
export type PublishWorkflowResult =
    | {
          outcome: "published" | "already-published";
          publicationNumber: number;
          workflowFormatVersion: string;
          digest: string;
      }
    | { outcome: "blocking-findings"; findings: readonly Finding[] }
    | { outcome: "not-found" }
    | { outcome: "revision-not-found" };

/**
 * The workflow-authoring operations over one workflow database: parse,
 * validate, store drafts and revisions, rewind, publish, and retrieve
 * publications. Validation runs on the text that will be stored,
 * so the findings a save returns anchor to the text retrieval returns.
 */
export class WorkflowService {
    private readonly workflows: WorkflowRepository;
    private readonly validator: WorkflowValidator;
    private readonly registry: WorkflowFormatRegistry;

    private constructor(
        workflows: WorkflowRepository,
        validator: WorkflowValidator,
        registry: WorkflowFormatRegistry,
    ) {
        this.workflows = workflows;
        this.validator = validator;
        this.registry = registry;
    }

    /**
     * Creates a service over one service-owned database handle. The service
     * borrows the handle: it never closes the pool, because readiness probes
     * and every other operation in the process share that same connection.
     */
    static create(database: DatabaseHandle): WorkflowService {
        return new WorkflowService(
            new WorkflowRepository(database.db, new PublicationPreparer(V1_RULE_SET)),
            WORKFLOW_VALIDATOR,
            RULE_SET_REGISTRY,
        );
    }

    /** Validates stored document text without saving anything. */
    async validate(documentText: string): Promise<ValidateOutcome> {
        const result = this.validator.validate(documentText);
        return { findings: result.findings, validForPublication: result.validForPublication };
    }

    /**
     * Creates a draft: assigns the workflow `id`, injects it into the
     * stored document (an author-supplied `id` is replaced, never
     * honored), and stores the injected text as the first revision.
     * Documents that are not JSON objects are stored as submitted;
     * validation reports the shape finding and the save still succeeds.
     */
    async createDraft(documentText: string, name: string | null): Promise<CreatedDraft> {
        const parsed = parseWorkflow(documentText);
        if (!parsed.ok) throw new WorkflowApiError(workflowParseFailure(parsed.findings));
        const workflowId = mintUuidV7();
        const text = isJsonObject(parsed.document)
            ? replaceWorkflowId(parsed.text, workflowId)
            : parsed.text;
        const result = this.validateStoredText(text);
        return this.workflows.createDraft({
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
        documentText: string,
        baseRevision: string,
        name: string | null,
    ): Promise<SaveRevisionResult> {
        const parsed = parseWorkflow(documentText);
        if (!parsed.ok) throw new WorkflowApiError(workflowParseFailure(parsed.findings));
        let text = parsed.text;
        if (isJsonObject(parsed.document)) {
            const embeddedId = parsed.document.id;
            if (embeddedId === undefined) {
                text = insertWorkflowId(parsed.text, workflowId);
            } else if (embeddedId !== workflowId) {
                // The addressed workflow is authoritative: when it does not
                // exist the save is 404, and the embedded-id disagreement
                // only matters against a workflow that exists.
                const current = await this.workflows.getCurrentRevision(workflowId);
                if (!current) return { outcome: "not-found" };
                throw new WorkflowApiError(
                    workflowIdentityConflict(
                        `The document's embedded id ${JSON.stringify(embeddedId)} does not match the addressed workflow ${workflowId}`,
                    ),
                );
            }
        }
        const result = this.validateStoredText(text);
        return this.workflows.saveRevision(workflowId, {
            baseRevision,
            content: text,
            findings: result.findings,
            name,
        });
    }

    /** Returns the draft's current revision, or null when the workflow does not exist. */
    async getCurrentRevision(workflowId: string): Promise<StoredRevision | null> {
        return this.workflows.getCurrentRevision(workflowId);
    }

    /** Returns one stored revision byte-exact, or null when it does not exist. */
    async getRevision(workflowId: string, revisionId: string): Promise<StoredRevision | null> {
        return this.workflows.getRevision(workflowId, revisionId);
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
        const result = await this.workflows.rewind(workflowId, targetRevisionId);
        switch (result.outcome) {
            case "rewound":
                return result;
            case "no-op": {
                const current = await this.workflows.getCurrentRevision(workflowId);
                if (!current) throw new Error(`workflow ${workflowId} has no current revision`);
                return { outcome: "no-op", revision: current };
            }
            default:
                return result;
        }
    }

    /**
     * Publishes the draft's current revision: re-validates the stored
     * content, selects the declared format version's rule set by exact match, and
     * stores the canonical text under the next per-workflow publication number.
     * Republishing the same revision returns the existing publication.
     */
    async publish(workflowId: string): Promise<PublishWorkflowResult> {
        const current = await this.workflows.getCurrentRevision(workflowId);
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
        const { ruleSet, workflowFormatVersion } = this.selectRuleSet(parsed.document);
        const prepared = await new PublicationPreparer(ruleSet).prepare(parsed.document);
        const stored = await this.workflows.publish({
            workflowId,
            revisionId: current.revisionId,
            canonicalText: prepared.canonicalText,
            digest: prepared.digest,
            workflowFormatVersion,
        });
        return this.publishResult(stored, workflowFormatVersion, prepared);
    }

    /** Returns one publication after storage-side digest verification, or null. */
    async getPublication(
        workflowId: string,
        publicationNumber: number,
    ): Promise<Publication | null> {
        return this.workflows.getPublication(workflowId, publicationNumber);
    }

    /**
     * Validates the text that will be stored, so stored findings anchor to
     * the text retrieval returns. The text parsed strictly already; a
     * parse failure at this point is an invariant violation.
     */
    private validateStoredText(text: string): ValidationResult {
        return this.validator.validate(text);
    }

    /** Selects the declared format version's rule set by exact match. */
    private selectRuleSet(document: Record<string, unknown>): {
        ruleSet: WorkflowFormatRuleSet;
        workflowFormatVersion: string;
    } {
        const declared = document.workflowFormatVersion;
        if (typeof declared !== "string") {
            throw new Error("validated document declares a non-string workflowFormatVersion");
        }
        const ruleSet = this.registry.select(declared);
        // An unknown version is a blocking finding, so a validated document
        // never reaches this line with an unselectable version.
        if (ruleSet === undefined) {
            throw new Error(`no rule set registered for validated version '${declared}'`);
        }
        return { ruleSet, workflowFormatVersion: declared };
    }

    /** Maps the storage outcome onto the API result, adding the computed publication values. */
    private publishResult(
        stored: PublishResult,
        workflowFormatVersion: string,
        prepared: PublicationPreparation,
    ): PublishWorkflowResult {
        switch (stored.outcome) {
            case "published":
            case "already-published":
                return {
                    outcome: stored.outcome,
                    publicationNumber: stored.publicationNumber,
                    workflowFormatVersion,
                    digest: prepared.digest,
                };
            default:
                return stored;
        }
    }
}

/** Checks whether a parsed document is a JSON object (the injectable root shape). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
