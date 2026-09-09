/** One row of `publications`: an immutable publication. */
export interface PublicationRow {
    workflowId: string;
    /** Per-workflow monotonic integer starting at 1. */
    publicationNumber: number;
    /** The source revision of the published bytes. */
    revisionId: string;
    /** The declared `workflowFormatVersion` of the published document. */
    workflowFormatVersion: string;
    /** The full RFC 8785 canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    createdAt: Date;
}
