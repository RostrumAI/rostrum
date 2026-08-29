/** One row of `workflows`: the draft and its current-revision pointer. */
export interface WorkflowRow {
    /** The server-assigned workflow `id`; the draft shares it. */
    id: string;
    /** The draft's current revision, or null only before the first save lands. */
    currentRevision: string | null;
    createdAt: Date;
    updatedAt: Date;
}
