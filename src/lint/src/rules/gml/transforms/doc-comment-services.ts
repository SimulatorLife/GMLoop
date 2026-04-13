import {
    collectAdjacentLeadingSourceLineComments,
    collectLeadingProgramLineComments,
    collectSyntheticDocCommentLines,
    computeSyntheticFunctionDocLines,
    extractLeadingNonDocCommentLines,
    getArgumentIndexFromIdentifier,
    getArgumentIndexFromReferenceNode,
    getIdentifierFromParameterNode,
    isDocLikeLeadingLine,
    mergeSyntheticDocComments,
    prepareDocCommentEnvironment,
    promoteLeadingDocCommentTextToDescription,
    reorderDescriptionLinesToTop,
    resolveParameterName
} from "../../../doc-comment/index.js";

/**
 * Stable doc-comment contract for GML parser transforms.
 *
 * The adapter keeps transform modules insulated from the `src/doc-comment`
 * directory layout so those internals can evolve without forcing every
 * transform consumer to chase deeper relative imports.
 */
export const gmlTransformDocCommentServices = Object.freeze({
    collectAdjacentLeadingSourceLineComments,
    collectLeadingProgramLineComments,
    collectSyntheticDocCommentLines,
    computeSyntheticFunctionDocLines,
    extractLeadingNonDocCommentLines,
    getArgumentIndexFromIdentifier,
    getArgumentIndexFromReferenceNode,
    getIdentifierFromParameterNode,
    isDocLikeLeadingLine,
    mergeSyntheticDocComments,
    prepareDocCommentEnvironment,
    promoteLeadingDocCommentTextToDescription,
    reorderDescriptionLinesToTop,
    resolveParameterName
});
