/** How a revision row came to exist: an author save, or a rewind-appended copy. */
export type RevisionType = "save" | "rewind";

/** One row of `revisions`: an immutable checkpoint of the draft. */
export interface RevisionRow {
    /** The server-assigned revision `id`. */
    id: string;
    workflowId: string;
    /** The exact submitted bytes; retrieval returns them unchanged. */
    content: string;
    /** The validation findings snapshot, serialized as JSON. */
    findings: string;
    /** The origin of the revision: an author save or a rewind-appended copy. */
    type: RevisionType;
    /** Optional author-supplied checkpoint label. */
    name: string | null;
    createdAt: Date;
}
