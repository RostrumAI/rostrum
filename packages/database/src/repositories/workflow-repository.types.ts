import type { Finding } from "@rostrum/workflow";
import type { RevisionType } from "../schema/revisions";

/**
 * The data contract of {@link WorkflowRepository}: the stored shapes the
 * Control API consumes and the inputs and typed outcomes of every
 * operation. Expected state rejections (stale `baseRevision`, unknown
 * workflows, missing revisions) are outcome members, not exceptions;
 * contract violations throw the errors in `workflow-repository.errors.ts`.
 */

/** A stored revision as applications consume it. */
export interface Revision {
    /** The revision's id. */
    revisionId: string;
    /** The owning draft's id. */
    workflowId: string;
    /** The optional display label stored with the revision. */
    name: string | null;
    /** The exact submitted bytes; byte-identical to what was saved. */
    content: string;
    /** The origin of the revision: an author save or a rewind-appended copy. */
    type: RevisionType;
    /** The validation findings snapshot stored with the revision. */
    findings: Finding[];
    /** Creation time according to the database clock. */
    createdAt: Date;
}

/** Input to `WorkflowRepository.createDraft`. */
export interface CreateDraftInput {
    /**
     * The workflow `id` to create the draft under, when the caller has
     * already minted it — the Control API mints the id first so it can
     * inject it into the stored document. When absent the repository
     * mints one. Either way the server owns the id; it is never an
     * author-supplied value.
     */
    workflowId?: string;
    /** The exact submitted bytes, stored and returned unchanged. */
    content: string;
    /** The findings snapshot to store with the revision. */
    findings: readonly Finding[];
    /** Optional display label for the revision. */
    name?: string | null;
}

/** The created draft: the workflow `id` and its first revision. */
export interface CreatedDraft {
    /** The new draft's id. */
    workflowId: string;
    /** The first revision, identical to what a save returns. */
    revision: Revision;
}

/** Input to `WorkflowRepository.saveRevision`. */
export interface SaveRevisionInput {
    /** The revision id the client last saw; null only for the first save. */
    baseRevision: string | null;
    /** The exact submitted bytes, stored and returned unchanged. */
    content: string;
    /** The findings snapshot to store with the revision. */
    findings: readonly Finding[];
    /** Optional display label for the revision. */
    name?: string | null;
}

/**
 * The result of one save attempt. `conflict` carries the draft's current
 * revision so a caller can answer 409 without a second query.
 */
export type SaveRevisionResult =
    | { outcome: "saved"; revision: Revision }
    | { outcome: "conflict"; currentRevision: Revision }
    | { outcome: "workflow-not-found" };

/** The result of one rewind attempt. */
export type RewindResult =
    | { outcome: "rewound"; revision: Revision }
    | { outcome: "no-op" }
    | { outcome: "target-not-found" }
    | { outcome: "workflow-not-found" };

/** Input to `WorkflowRepository.publish`; produced by PublicationCanonicalizer. */
export interface PublicationInsertInput {
    /** The publishing draft's id. */
    workflowId: string;
    /** The source revision inside that draft. */
    revisionId: string;
    /** The full canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    /** The format contract the canonical text satisfies, such as `v1`. */
    workflowFormatVersion: string;
}

/**
 * The result of one publish attempt. `published` and `already-published`
 * return the same publication number; `workflow-not-found` reports an unknown
 * workflow and `revision-not-found` a revision that does not belong to it, the
 * two 404 cases of the publish contract, typed instead of thrown.
 */
export type PublishResult =
    | { outcome: "published"; publicationNumber: number }
    | { outcome: "already-published"; publicationNumber: number }
    | { outcome: "workflow-not-found" }
    | { outcome: "revision-not-found" };

/** One retrieved publication with its verified digest. */
export interface Publication {
    /** The per-draft publication number of this publication. */
    publicationNumber: number;
    /** The source revision the published bytes came from. */
    revisionId: string;
    /** The format contract the canonical text satisfies. */
    workflowFormatVersion: string;
    /** The full canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    /** Publication time according to the database clock. */
    createdAt: Date;
}
