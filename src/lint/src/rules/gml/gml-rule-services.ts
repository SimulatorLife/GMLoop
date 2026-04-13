import {
    convertLegacyReturnsDescriptionLinesToMetadata,
    promoteLeadingDocCommentTextToDescription,
    resolveParameterName
} from "../../doc-comment/index.js";
import { createLimitedRecoveryProjection } from "../../language/index.js";
import { forEachScientificNotationToken } from "../../malformed/index.js";
import { getDeprecatedIdentifierCatalogEntry } from "../../services/deprecated-identifiers/index.js";

/**
 * Stable doc-comment contract for GML rule implementations.
 *
 * Rules that need doc-comment helpers should import from this object rather
 * than reaching three directory levels into `src/lint/src/doc-comment/`. When
 * the internal layout of that layer changes, only this file needs updating —
 * rule consumers stay stable.
 *
 * Transform modules that need broader doc-comment access should continue to
 * use {@link ./transforms/doc-comment-services.js}.
 */
export const gmlRuleDocCommentServices = Object.freeze({
    convertLegacyReturnsDescriptionLinesToMetadata,
    promoteLeadingDocCommentTextToDescription,
    resolveParameterName
});

/**
 * Stable deprecated-identifier contract for GML rule implementations.
 *
 * Rules that report on deprecated API usage should import from this object
 * rather than reaching three directory levels into
 * `src/lint/src/services/deprecated-identifiers/`. The catalog API behind
 * this object can be reorganised without updating every rule that consults it.
 */
export const gmlRuleDeprecatedIdentifierServices = Object.freeze({
    getDeprecatedIdentifierCatalogEntry
});

/**
 * Stable language-layer contract for GML rule implementations.
 *
 * Rules that work with parser-recovery projections should import from this
 * object rather than reaching three directory levels into
 * `src/lint/src/language/`. Only {@link createLimitedRecoveryProjection} is
 * surfaced here; lower-level recovery constants remain language-owned and
 * must not be consumed by unrelated rules.
 */
export const gmlRuleLanguageServices = Object.freeze({
    createLimitedRecoveryProjection
});

/**
 * Stable malformed-source contract for GML rule implementations.
 *
 * Rules that operate on scientific-notation token spans should import from
 * this object rather than reaching three directory levels into
 * `src/lint/src/malformed/`, and especially not by naming a specific
 * implementation file within that layer.
 */
export const gmlRuleMalformedServices = Object.freeze({
    forEachScientificNotationToken
});
