/** One row of `published_versions`: an immutable published release. */
export interface PublishedVersionRow {
    workflowId: string;
    /** Per-workflow monotonic integer starting at 1. */
    versionNumber: number;
    /** The source revision of the published bytes. */
    revisionId: string;
    /** The declared `interfaceVersion` of the published document. */
    interfaceVersion: string;
    /** The full RFC 8785 canonical document, metadata members included. */
    canonicalText: string;
    /** SHA-256 lowercase hex over the canonical form minus metadata members. */
    digest: string;
    createdAt: Date;
}
