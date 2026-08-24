/** One row of `workflows`: the draft and its current-revision pointer. */
export interface WorkflowRow {
    /** Server-minted workflow `id` (UUID v7); the draft shares it (E1-S3). */
    id: string;
    /** The draft's current revision, or null only before the first save lands. */
    currentRevision: string | null;
    createdAt: Date;
    updatedAt: Date;
}
