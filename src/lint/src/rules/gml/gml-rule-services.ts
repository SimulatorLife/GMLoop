import { Core } from "@gmloop/core";

import { printExpression, printNodeForAutofix, readNodeText } from "../../contracts/autofix-printing.js";
import {
    convertLegacyReturnsDescriptionLinesToMetadata,
    convertLegacyReturnsDescriptionLineToMetadata,
    normalizeDocParamName,
    promoteLeadingDocCommentTextToDescription,
    resolveParameterName
} from "../../doc-comment/index.js";
import { createLimitedRecoveryProjection } from "../../language/index.js";
import {
    collectRegionSourceLines,
    readRegionDirectiveType,
    resolveRegionDirectiveLineEnding
} from "../../language/region-directives.js";
import { getDeprecatedIdentifierCatalogEntry } from "../../services/deprecated-identifiers/index.js";
import {
    applySourceTextEdits,
    findMatchingBraceEndIndex,
    getVariableDeclarator,
    isAssignmentExpressionNode,
    isAstNodeRecord,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    reportFullTextRewrite,
    resolveLocFromIndex,
    walkAstNodes,
    walkAstNodesWithParent
} from "./rule-base-helpers.js";

/**
 * Stable doc-comment contract for GML rule implementations.
 *
 * Rules that need doc-comment helpers should import from this object rather
 * than reaching three directory levels into `src/lint/src/doc-comment/`. When
 * the internal layout of that layer changes, only this file needs updating —
 * rule consumers stay stable.
 *
 * Transform modules needing broader doc-comment access should import the
 * helpers directly from `src/lint/src/doc-comment/index.js`.
 */
export const gmlRuleDocCommentServices = Object.freeze({
    convertLegacyReturnsDescriptionLineToMetadata,
    convertLegacyReturnsDescriptionLinesToMetadata,
    normalizeDocParamName,
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
    forEachScientificNotationToken: Core.forEachScientificNotationToken,
    toPlainDecimalFromScientificLiteral: Core.toPlainDecimalFromScientificLiteral,
    trimInsignificantFractionalZeros: Core.trimInsignificantFractionalZeros
});

/**
 * Stable autofix-printing contract for GML rule implementations.
 *
 * Rules that need to print AST nodes back to source text for lint autofixes
 * should import from this object rather than reaching three directory levels
 * into `src/lint/src/contracts/autofix-printing.js`. When the printing logic
 * is refactored, only this file needs updating — rule consumers stay stable.
 */
export const gmlRuleAutofixServices = Object.freeze({
    printExpression,
    printNodeForAutofix,
    readNodeText
});

/**
 * Stable base-helper contract for cross-domain rule implementations.
 *
 * Rules implemented outside the `src/lint/src/rules/gml/` directory (for
 * example the feather rule factories under `rules/feather/rules/`) need a
 * narrow, stable surface for the most commonly-shared parsing helpers
 * (resolving a source offset to a 1-based line/column location, locating the
 * end of the brace block that opens at a given index, …). Reaching two
 * directory levels into the gml/ rules folder for those helpers would couple
 * consumers to the internal layout of the gml/ domain; this facade keeps
 * that coupling isolated to this file so the gml/ rule subtree can be
 * reorganised without churning every feather rule import.
 *
 * Only helpers whose consumers cross the gml/ domain boundary belong here;
 * helpers used exclusively inside the gml/ rules folder should continue to
 * be imported from `./rule-base-helpers.js` directly.
 */
export const gmlRuleBaseHelpersServices = Object.freeze({
    applySourceTextEdits,
    findMatchingBraceEndIndex,
    getVariableDeclarator,
    isAssignmentExpressionNode,
    isAstNodeRecord,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    reportFullTextRewrite,
    resolveLocFromIndex,
    walkAstNodes,
    walkAstNodesWithParent
});

/**
 * Stable region-directive contract for GML rule implementations.
 *
 * Rules that parse `#region`/`#endregion` lines should import from this
 * object rather than reaching into `src/lint/src/language/region-directives.js`
 * directly. When the implementation is reorganised (for example split across
 * several files or specialised into per-rule variants), only this facade
 * needs updating and rule consumers stay stable.
 *
 * The matching {@link RegionDirectiveType} and {@link RegionSourceLine} type
 * aliases are re-exported from this module so consumers can depend on a
 * single, versioned entry point instead of naming the implementation file in
 * their `import type` specifiers.
 */
export const gmlRuleRegionDirectiveServices = Object.freeze({
    collectRegionSourceLines,
    readRegionDirectiveType,
    resolveRegionDirectiveLineEnding
});

export { type RegionDirectiveType, type RegionSourceLine } from "../../language/region-directives.js";
