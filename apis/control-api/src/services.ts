import type { WorkflowService } from "./workflows/service";

/**
 * The services a feature handler can use. The app builds one instance at
 * boot and hands it to every handler factory, so handlers receive their
 * dependencies instead of reaching module state. Tests inject fakes
 * through the same factories.
 */
export interface Services {
    readonly workflows: WorkflowService;
}
