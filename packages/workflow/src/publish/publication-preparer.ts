import type { InterfaceRuleSet } from "../rules/interface-rule-set";
import { CanonicalizationError, canonicalize } from "./canonical-json";

/** The canonical published form of a workflow document and its content digest. */
export interface PublicationPreparation {
  /**
   * The full document in RFC 8785 canonical form, including metadata
   * members. This is the text stored with a published version.
   */
  canonicalText: string;
  /**
   * SHA-256 of the canonical form as 64 lowercase hex characters,
   * computed after the rule set's metadata members are removed, so a
   * metadata-only edit leaves the digest unchanged (E1-S3, E1-S4).
   */
  digest: string;
}

/**
 * Prepares a valid workflow document for publication.
 *
 * The preparer canonicalizes the document once and computes the digest
 * over the definitional content: the rule set's metadata members
 * (`name` and `description` in v1) are removed before canonicalization.
 * The document must be duplicate-key free, which parse-based validation
 * guarantees; canonicalization rejects non-finite numbers, which no
 * canonical form can represent.
 */
export class PublicationPreparer {
  private readonly metadataMembers: readonly string[];

  /** Constructs a preparer bound to one interface rule set's metadata classification. */
  constructor(ruleSet: InterfaceRuleSet) {
    this.metadataMembers = ruleSet.metadataMembers;
  }

  /**
   * Canonicalizes the document and computes its publication digest.
   *
   * Throws `CanonicalizationError` when the document is not a JSON
   * object or contains a value with no canonical form.
   */
  async prepare(document: object): Promise<PublicationPreparation> {
    if (document === null || Array.isArray(document)) {
      throw new CanonicalizationError("The workflow document must be a JSON object");
    }
    // The digest covers definitional content only: metadata members are
    // copied out before canonicalization so editing them later does not
    // change the digest.
    const record = document as Record<string, unknown>;
    const definitional: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!this.metadataMembers.includes(key)) {
        definitional[key] = value;
      }
    }
    const canonicalText = canonicalize(record);
    const digest = await sha256Hex(canonicalize(definitional));
    return { canonicalText, digest };
  }
}

/** Computes the SHA-256 digest of a string as lowercase hexadecimal. */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
