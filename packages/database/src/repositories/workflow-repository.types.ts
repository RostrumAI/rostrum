import type { Finding } from "@rostrum/workflow";

/**
 * The data contract of {@link WorkflowRepository}: the stored shapes the
 * Control API consumes and the inputs and typed outcomes of every
 * operation. Expected state rejections (stale `baseRevision`, unknown
 * workflows, missing revisions) are outcome members, not exceptions;
 * contract violations throw the errors in `workflow-repository.errors.ts`.
 */

/** A stored revision as applications consume it. */
export interface StoredRevision {
    revisionId: string;
    workflowId: string;
    name: string | null;
    /** The exact submitted bytes; byte-identical to what was saved. */
    content: string;
    /** The validation findings snapshot stored with the revision (E1-S3). */
    findings: Finding[];
    createdAt: Date;
}

/** Input to `WorkflowRepository.createDraft`. */
export interface CreateDraftInput {
    /**
     * The server-minted workflow `id`, already injected into `content`.
     * The caller mints it (the `uuid` package's `v7`) before serializing
     * the document, so storage never rewrites bytes.
     */
    workflowId: string;
    content: string;
    findings: readonly Finding[];
    name?: string | null;
}

/** The created draft: the workflow `id` and its first revision. */
export interface CreatedDraft {
    workflowId: string;
    revision: StoredRevision;
}

/** Input to `WorkflowRepository.saveRevision`. */
export interface SaveRevisionInput {
    /** The revision id the client last saw; null only for the first save. */
    baseRevision: string | null;
    content: string;
    findings: readonly Finding[];
    name?: string | null;
}

/**
 * The result of one save attempt. `conflict` carries the draft's current
 * revision so a caller can answer 409 without a second query (E1-S3 save
 * contract).
 */
export type SaveRevisionResult =
    | { outcome: "saved"; revision: StoredRevision }
    | { outcome: "conflict"; currentRevision: StoredRevision }
    | { outcome: "not-found" };

/** The result of one rewind attempt (E1-S3 rewind contract). */
export type RewindResult =
    | { outcome: "rewound"; deletedRevisionIds: string[] }
    | { outcome: "no-op" }
    | { outcome: "refused"; publishedSourceRevisionId: string }
    | { outcome: "target-not-found" }
    | { outcome: "not-found" };

/** Input to `WorkflowRepository.publish`; produced by PublicationPreparer. */
export interface PublishInput {
    workflowId: string;
    revisionId: string;
    /** The full canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    interfaceVersion: string;
}

/**
 * The result of one publish attempt. `published` and `already-published`
 * return the same version; `not-found` reports an unknown workflow and
 * `revision-not-found` a revision that does not belong to it — the two
 * 404 cases of the E1-S3 publish contract, typed instead of thrown.
 */
export type PublishResult =
    | { outcome: "published"; versionNumber: number }
    | { outcome: "already-published"; versionNumber: number }
    | { outcome: "not-found" }
    | { outcome: "revision-not-found" };

/** One retrieved published version with its verified digest. */
export interface PublishedVersion {
    versionNumber: number;
    revisionId: string;
    interfaceVersion: string;
    /** The full canonical document, metadata members included. */
    canonicalText: string;
    digest: string;
    createdAt: Date;
}
