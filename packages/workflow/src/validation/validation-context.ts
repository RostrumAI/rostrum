import { FindingFactory } from "../findings";
import type { InterfaceRuleSet } from "../rules/interface-rule-set";
import type { WorkflowDocument } from "../schema";
import type { SourceMap } from "../source-map";
import { WorkflowGraph } from "./workflow-graph";

/**
 * State shared by the stages of one validation run.
 *
 * The context carries the parsed document, the source map from stage 0,
 * and the finding factory that attaches line and column numbers. The
 * version stage selects the interface rule set, and stages that build
 * graph structures share one lazily constructed {@link WorkflowGraph}.
 */
export class ValidationContext {
    /** The parsed document, or the caller-supplied document for `validateDocument`. */
    readonly document: unknown;
    /** Pointer-to-location map from stage 0, or null when validating a parsed document. */
    readonly sourceMap: SourceMap | null;
    /** Finding factory bound to the source map. */
    readonly findings: FindingFactory;

    private selectedRuleSet: InterfaceRuleSet | null = null;
    private documentGraph: WorkflowGraph | null = null;

    /** Constructs a context for one validation run. */
    constructor(document: unknown, sourceMap: SourceMap | null) {
        this.document = document;
        this.sourceMap = sourceMap;
        this.findings = new FindingFactory(sourceMap);
    }

    get ruleSet(): InterfaceRuleSet {
        if (!this.selectedRuleSet) {
            throw new Error("No interface rule set was selected for this validation run");
        }
        return this.selectedRuleSet;
    }

    /**
     * The parsed document as a v1 workflow document.
     *
     * The pipeline gates every consumer of this accessor behind the
     * identity stage, which guarantees the document passed schema
     * validation; this is the one place the untyped-to-typed transition
     * happens. Stages keep their own defensive re-checks because they are
     * also invoked directly in tests.
     */
    get typedDocument(): WorkflowDocument {
        return this.document as WorkflowDocument;
    }

    /** Records the rule set chosen by exact version match. */
    selectRuleSet(ruleSet: InterfaceRuleSet): void {
        this.selectedRuleSet = ruleSet;
    }

    /**
     * Gets the document graph, building it on first use.
     *
     * Only stages gated on the identity stage read the graph, so the
     * document is shape-valid and its identifiers resolve when the graph
     * is constructed.
     */
    get graph(): WorkflowGraph {
        if (!this.documentGraph)
            this.documentGraph = new WorkflowGraph(this.document as WorkflowDocument);
        return this.documentGraph;
    }
}
