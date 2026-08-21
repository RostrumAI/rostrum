import type { SourceMap } from "./source-map";

/**
 * Validation findings, the shared result of draft saves, explicit
 * validation, and publication (E1-S2).
 *
 * A finding carries a stable dot-namespaced `code` — the contract automated
 * authors match on — plus a human-readable message, a blocking flag, a JSON
 * Pointer, one-based line and column when the source text is available,
 * related locations for cross-reference conflicts, and structured details
 * for automated repair.
 */

/** One additional location involved in a cross-reference conflict. */
export interface RelatedLocation {
  /** JSON Pointer (RFC 6901) of the related location. */
  path: string;
  /** Human-readable description of this location's role in the conflict. */
  message: string;
}

/** One validation result: the reason a document fails a rule, or an advisory note. */
export interface Finding {
  /** Stable dot-namespaced identifier, for example `workflow.graph.cycle`. */
  code: string;
  /** Human-readable explanation of the problem and, where relevant, the received value. */
  message: string;
  /** True if the finding prevents publication; false for advisory findings. */
  blocking: boolean;
  /** JSON Pointer (RFC 6901) of the offending value, or `""` for a document-level problem. */
  path: string;
  /** One-based line in the source text, when it is available. */
  line?: number;
  /** One-based column in the source text, when it is available. */
  column?: number;
  /** Additional pointers involved in a cross-reference conflict. */
  relatedLocations?: RelatedLocation[];
  /** Structured context an automated author can repair without parsing the message. */
  details?: Record<string, unknown>;
}

/** The input to {@link FindingFactory.create}; `blocking` defaults to true. */
export interface FindingSpec {
  code: string;
  message: string;
  path: string;
  blocking?: boolean;
  relatedLocations?: RelatedLocation[];
  details?: Record<string, unknown>;
}

/**
 * Creates findings and attaches source locations.
 *
 * The factory resolves each finding's JSON Pointer against the source map
 * built at parse time and fills in `line` and `column` when the pointer
 * exists. Without a source map — validation of an already-parsed document —
 * findings carry no line or column.
 */
export class FindingFactory {
  private readonly sourceMap: SourceMap | null;

  /** Constructs a factory over the parsed document's source map, or null when absent. */
  constructor(sourceMap: SourceMap | null = null) {
    this.sourceMap = sourceMap;
  }

  /** Creates a finding from the spec, attaching line and column when the pointer resolves. */
  create(spec: FindingSpec): Finding {
    const finding: Finding = {
      code: spec.code,
      message: spec.message,
      blocking: spec.blocking ?? true,
      path: spec.path,
    };
    const pointer = this.sourceMap?.[spec.path];
    if (pointer) {
      finding.line = pointer.value.line;
      finding.column = pointer.value.column;
    }
    if (spec.relatedLocations) {
      finding.relatedLocations = spec.relatedLocations;
    }
    if (spec.details) {
      finding.details = spec.details;
    }
    return finding;
  }
}

/**
 * Compares two findings by pointer, then code, using UTF-16 code-unit order.
 *
 * Code-unit order keeps the sort deterministic across runtimes and locales,
 * which conformance suites rely on when they compare findings by equality.
 */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.code !== b.code) {
    return a.code < b.code ? -1 : 1;
  }
  return 0;
}

/** Returns the findings sorted by pointer then code, leaving the input untouched. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(compareFindings);
}
