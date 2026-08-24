/** One row of `revisions`: an immutable checkpoint of the draft. */
export interface RevisionRow {
    /** Server-minted revision `id` (UUID v7). */
    id: string;
    workflowId: string;
    /** The exact submitted bytes; retrieval returns them unchanged (E1-S3). */
    content: string;
    /** The validation findings snapshot, serialized as JSON. */
    findings: string;
    /** Optional author-supplied checkpoint label. */
    name: string | null;
    createdAt: Date;
}
